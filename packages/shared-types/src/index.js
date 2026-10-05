"use strict";
// Domain vocabulary shared by the drift engine and the database enums.
// Tuples (not plain unions) so the database can build its pgEnums from the same source.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.POLICY_ACTIONS = exports.PATCH_GENERATORS = exports.DELIVERY_STATUSES = exports.DELIVERY_CHANNELS = exports.ENDPOINT_TYPES = exports.NOTIFICATION_CHANNELS = exports.NOTIFICATION_EVENTS = exports.CONTRACT_SOURCES = exports.KEY_TYPES = exports.CONSUMER_KINDS = exports.ORG_ROLES = exports.GOVERNANCE_STATUSES = exports.PATCH_STATUSES = exports.SERVICE_STATUSES = exports.SEVERITIES = exports.DRIFT_TYPES = void 0;
exports.DRIFT_TYPES = [
    'FIELD_RENAMED',
    'FIELD_DELETED',
    'FIELD_ADDED',
    'TYPE_CHANGED',
    'STRUCTURE_MUTATION',
    'MULTI_FIELD_MUTATION',
];
exports.SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
exports.SERVICE_STATUSES = [
    'HEALTHY',
    'DEGRADED',
    'DRIFTING',
    'FAILING',
];
exports.PATCH_STATUSES = [
    'GENERATING',
    'VALIDATED',
    'CANARY',
    'ACTIVE',
    'FAILED',
    'SUPERSEDED',
    'ROLLED_BACK',
];
exports.GOVERNANCE_STATUSES = [
    'AUTO_APPROVED',
    'PENDING_REVIEW',
    'APPROVED',
    'REJECTED',
    'ESCALATED',
];
/** Highest privilege first: owner > admin > reviewer > viewer. */
exports.ORG_ROLES = ['owner', 'admin', 'reviewer', 'viewer'];
exports.CONSUMER_KINDS = ['frontend', 'backend'];
/** Publishable keys may ship in browser code (origin-restricted); secret keys are server-only. */
exports.KEY_TYPES = ['publishable', 'secret'];
exports.CONTRACT_SOURCES = ['traffic', 'openapi'];
/** Things members can be notified about. */
exports.NOTIFICATION_EVENTS = [
    'drift.breaking',
    'patch.awaiting_review',
    'patch.rejected',
    'patch.promoted',
    'patch.rolled_back',
];
/** Personal delivery channels (the in-app inbox is always on). */
exports.NOTIFICATION_CHANNELS = ['email', 'push'];
/** Organization-wide integrations. */
exports.ENDPOINT_TYPES = ['slack', 'webhook'];
exports.DELIVERY_CHANNELS = ['email', 'push', 'slack', 'webhook'];
exports.DELIVERY_STATUSES = ['pending', 'sending', 'sent', 'dead'];
__exportStar(require("./api.js"), exports);
exports.PATCH_GENERATORS = ['gemini', 'fallback', 'unknown'];
exports.POLICY_ACTIONS = ['promote', 'rollback', 'wait', 'blocked'];
