import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { encryptSecret, hashToken, randomToken } from '@orchestrator/crypto';
import {
  orgInvitations,
  orgMembers,
  organizations,
  type DrizzleDb,
  type OrgInvitation,
} from '@orchestrator/database';
import type {
  CreatedInvitation,
  InvitationPreview,
  InvitationView,
  MemberView,
  OrgRole,
  OrgSettingsView,
  OrgSummary,
} from '@orchestrator/shared-types';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { roleAtLeast, type OrgAccess } from '../auth/org.guard.js';
import type { AuthenticatedUser } from '../auth/token-verifier.js';
import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from '../config/gateway-config.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { GatewayEventsService } from '../events/gateway-events.service.js';
import { ActivityService } from './activity.service.js';
import { OrgSettingsService } from './org-settings.service.js';
import type {
  CreateOrgDto,
  InviteMemberDto,
  UpdateMemberDto,
  UpdateOrgSettingsDto,
} from './orgs.dto.js';

const INVITATION_TTL_MS = 7 * 24 * 3_600_000;
const RESERVED_SLUGS = new Set([
  'api',
  'admin',
  'app',
  'login',
  'signup',
  'invite',
  'onboarding',
  'settings',
  'new',
]);

const actorOf = (user: AuthenticatedUser) => user.email ?? user.id;

@Injectable()
export class OrgsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(OrgSettingsService) private readonly settings: OrgSettingsService,
    @Inject(GatewayEventsService) private readonly events: GatewayEventsService,
  ) {}

  async listForUser(user: AuthenticatedUser): Promise<OrgSummary[]> {
    return this.db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        role: orgMembers.role,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(eq(orgMembers.userId, user.id))
      .orderBy(asc(organizations.name));
  }

  /** Self-serve onboarding: the creator becomes the organization's owner. */
  async create(
    user: AuthenticatedUser,
    dto: CreateOrgDto,
  ): Promise<OrgSummary> {
    if (!user.email)
      throw new BadRequestException('Your account needs an email address');
    if (RESERVED_SLUGS.has(dto.slug))
      throw new ConflictException(`"${dto.slug}" is reserved`);
    const org = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(organizations)
        .values({ slug: dto.slug, name: dto.name.trim() })
        .onConflictDoNothing()
        .returning();
      if (!created)
        throw new ConflictException(`The URL "${dto.slug}" is already taken`);
      await tx
        .insert(orgMembers)
        .values({
          orgId: created.id,
          userId: user.id,
          email: user.email!,
          role: 'owner',
        });
      return created;
    });
    await this.activity.record(org.id, {
      actor: actorOf(user),
      action: 'org.created',
      targetType: 'organization',
      targetId: org.id,
    });
    return { id: org.id, slug: org.slug, name: org.name, role: 'owner' };
  }

  async getSettings(org: OrgAccess): Promise<OrgSettingsView> {
    const [row] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, org.id))
      .limit(1);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      driftThreshold: row.driftThreshold,
      canaryPercent: row.canaryPercent,
      geminiModel: row.geminiModel,
      geminiKeyConfigured: Boolean(row.geminiApiKeyEnc),
      defaults: {
        driftThreshold: this.config.driftThreshold,
        canaryPercent: this.config.canaryPercent,
        geminiModel: this.config.gemini.model,
      },
    };
  }

  async updateSettings(
    org: OrgAccess,
    dto: UpdateOrgSettingsDto,
    user: AuthenticatedUser,
  ): Promise<OrgSettingsView> {
    const changes: Partial<typeof organizations.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (dto.name !== undefined) changes.name = dto.name.trim();
    if (dto.driftThreshold !== undefined)
      changes.driftThreshold = dto.driftThreshold;
    if (dto.canaryPercent !== undefined)
      changes.canaryPercent = dto.canaryPercent;
    if (dto.geminiModel !== undefined)
      changes.geminiModel = dto.geminiModel || null;
    if (dto.geminiApiKey !== undefined)
      changes.geminiApiKeyEnc = dto.geminiApiKey
        ? encryptSecret(dto.geminiApiKey, this.config.encryptionKey)
        : null;
    await this.db
      .update(organizations)
      .set(changes)
      .where(eq(organizations.id, org.id));
    this.settings.invalidate(org.id);
    await this.activity.record(org.id, {
      actor: actorOf(user),
      action: 'org.settings_updated',
      targetType: 'organization',
      targetId: org.id,
      // Never log secret values, only which settings changed.
      details: { changed: Object.keys(dto) },
    });
    return this.getSettings(org);
  }

  async listMembers(org: OrgAccess): Promise<MemberView[]> {
    const rows = await this.db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.orgId, org.id))
      .orderBy(asc(orgMembers.createdAt));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      email: row.email,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async updateMember(
    org: OrgAccess,
    memberId: string,
    dto: UpdateMemberDto,
    user: AuthenticatedUser,
  ): Promise<MemberView> {
    const member = await this.findMember(org, memberId);
    this.assertCanManage(org, member.role, dto.role);
    if (member.role === 'owner' && dto.role !== 'owner')
      await this.assertNotLastOwner(org);
    await this.db
      .update(orgMembers)
      .set({ role: dto.role })
      .where(eq(orgMembers.id, memberId));
    await this.activity.record(org.id, {
      actor: actorOf(user),
      action: 'member.role_changed',
      targetType: 'member',
      targetId: member.email,
      details: { from: member.role, to: dto.role },
    });
    return { ...(await this.listMembers(org)).find((m) => m.id === memberId)! };
  }

  async removeMember(
    org: OrgAccess,
    memberId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const member = await this.findMember(org, memberId);
    // Anyone may leave; removing others needs admin rights over their role.
    if (member.userId !== user.id) this.assertCanManage(org, member.role);
    if (member.role === 'owner') await this.assertNotLastOwner(org);
    await this.db.delete(orgMembers).where(eq(orgMembers.id, memberId));
    await this.activity.record(org.id, {
      actor: actorOf(user),
      action: member.userId === user.id ? 'member.left' : 'member.removed',
      targetType: 'member',
      targetId: member.email,
    });
  }

  async listInvitations(org: OrgAccess): Promise<InvitationView[]> {
    const rows = await this.db
      .select()
      .from(orgInvitations)
      .where(
        and(
          eq(orgInvitations.orgId, org.id),
          isNull(orgInvitations.acceptedAt),
          isNull(orgInvitations.revokedAt),
          gt(orgInvitations.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(orgInvitations.createdAt));
    return rows.map(toInvitationView);
  }

  async invite(
    org: OrgAccess,
    dto: InviteMemberDto,
    user: AuthenticatedUser,
  ): Promise<CreatedInvitation> {
    this.assertCanManage(org, 'viewer', dto.role);
    const email = dto.email.trim().toLowerCase();
    const [existing] = await this.db
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.orgId, org.id),
          sql`lower(${orgMembers.email}) = ${email}`,
        ),
      )
      .limit(1);
    if (existing) throw new ConflictException(`${email} is already a member`);
    const token = randomToken();
    const [invitation] = await this.db
      .insert(orgInvitations)
      .values({
        orgId: org.id,
        email,
        role: dto.role,
        tokenHash: hashToken(token, this.config.keyPepper),
        invitedBy: user.id,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      })
      .returning();
    const acceptUrl = `${this.config.appUrl}/invite/${token}`;
    await this.activity.record(org.id, {
      actor: actorOf(user),
      action: 'member.invited',
      targetType: 'invitation',
      targetId: email,
      details: { role: dto.role },
    });
    this.events.publish({
      type: 'member.invited',
      orgId: org.id,
      orgName: org.name,
      email,
      role: dto.role,
      acceptUrl,
      invitedBy: actorOf(user),
    });
    return { ...toInvitationView(invitation), acceptUrl };
  }

  async revokeInvitation(
    org: OrgAccess,
    invitationId: string,
    user: AuthenticatedUser,
  ) {
    const [revoked] = await this.db
      .update(orgInvitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(orgInvitations.id, invitationId),
          eq(orgInvitations.orgId, org.id),
          isNull(orgInvitations.acceptedAt),
        ),
      )
      .returning();
    if (!revoked) throw new NotFoundException('Invitation not found');
    await this.activity.record(org.id, {
      actor: actorOf(user),
      action: 'invitation.revoked',
      targetType: 'invitation',
      targetId: revoked.email,
    });
  }

  async previewInvitation(token: string): Promise<InvitationPreview> {
    const { invitation, orgName } = await this.openInvitation(token);
    return {
      orgName,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async acceptInvitation(
    token: string,
    user: AuthenticatedUser,
  ): Promise<OrgSummary> {
    const { invitation, orgName, orgSlug } = await this.openInvitation(token);
    if (
      !user.email ||
      user.email.toLowerCase() !== invitation.email.toLowerCase()
    )
      throw new ForbiddenException(
        `This invitation was sent to ${invitation.email}. Sign in with that address to accept it.`,
      );
    await this.db.transaction(async (tx) => {
      await tx
        .insert(orgMembers)
        .values({
          orgId: invitation.orgId,
          userId: user.id,
          email: invitation.email,
          role: invitation.role,
        })
        .onConflictDoNothing();
      await tx
        .update(orgInvitations)
        .set({ acceptedAt: new Date() })
        .where(eq(orgInvitations.id, invitation.id));
    });
    await this.activity.record(invitation.orgId, {
      actor: user.email,
      action: 'member.joined',
      targetType: 'member',
      targetId: user.email,
      details: { role: invitation.role },
    });
    return {
      id: invitation.orgId,
      slug: orgSlug,
      name: orgName,
      role: invitation.role,
    };
  }

  private async openInvitation(token: string) {
    const [row] = await this.db
      .select({
        invitation: orgInvitations,
        orgName: organizations.name,
        orgSlug: organizations.slug,
      })
      .from(orgInvitations)
      .innerJoin(organizations, eq(orgInvitations.orgId, organizations.id))
      .where(
        eq(orgInvitations.tokenHash, hashToken(token, this.config.keyPepper)),
      )
      .limit(1);
    if (!row || row.invitation.revokedAt)
      throw new NotFoundException('Invitation not found');
    if (row.invitation.acceptedAt)
      throw new GoneException('This invitation was already used');
    if (row.invitation.expiresAt < new Date())
      throw new GoneException('This invitation has expired');
    return row;
  }

  private async findMember(org: OrgAccess, memberId: string) {
    const [member] = await this.db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.id, memberId), eq(orgMembers.orgId, org.id)))
      .limit(1);
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  /** Admins manage reviewers and viewers; only owners may grant, change or remove owners and admins. */
  private assertCanManage(
    org: OrgAccess,
    currentRole: OrgRole,
    nextRole?: OrgRole,
  ): void {
    const touchesPrivileged = [currentRole, nextRole].some(
      (role) => role === 'owner' || role === 'admin',
    );
    if (
      touchesPrivileged ? org.role !== 'owner' : !roleAtLeast(org.role, 'admin')
    )
      throw new ForbiddenException(
        touchesPrivileged
          ? 'Only owners can manage owners and admins'
          : 'Admins only',
      );
  }

  private async assertNotLastOwner(org: OrgAccess): Promise<void> {
    const [{ owners }] = await this.db
      .select({ owners: sql<number>`count(*)::int` })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.role, 'owner')));
    if (owners <= 1)
      throw new ConflictException('An organization needs at least one owner');
  }
}

function toInvitationView(invitation: OrgInvitation): InvitationView {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}
