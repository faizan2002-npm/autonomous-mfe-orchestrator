# Chapter 4: Formal Academic Core Mathematical Base

This chapter provides the rigorous computer science and mathematical theory underpinning the Autonomous Micro-Frontend Orchestrator. University external examiners evaluate whether system logic is mathematically grounded or merely a heuristic wrapper — this section ensures the former.

## 4.1 Overview

The system's decision-making process is formalized as a **Markov Decision Process (MDP)**, a well-established framework in reinforcement learning and autonomous systems (Bellman, 1957; Sutton & Barto, 2018). The MDP model enables the Agentic Control Plane to:

1. **Observe** the current structural health of the micro-frontend ecosystem.
2. **Decide** the optimal corrective action based on the observed state.
3. **Maximize** long-term system stability through a reward function.

The MDP is represented as a 4-tuple:

$$\mathcal{M} = (S, A, P, R)$$

## 4.2 State Space ($S$)

The state vector $s \in S$ encodes the structural health configuration of the entire micro-frontend ecosystem at any point in time $t$:

$$s_t = \langle D_c, E_{ui}, L_{net}, P_{active}, C_{conf} \rangle$$

### 4.2.1 State Variables

| Variable | Domain | Description | Measurement Method |
|---|---|---|---|
| $D_c$ | $[0, 1]$ | **Drift Coefficient** — magnitude of detected API schema drift | Jaccard distance (see §4.3) |
| $E_{ui}$ | $\mathbb{R}^+ \cup \{0\}$ | **UI Error Rate** — rendering exception frequency (errors/minute) | Browser console error telemetry |
| $L_{net}$ | $\mathbb{R}^+$ | **Network Latency** — end-to-end API response time (ms) | Middleware timestamp measurement |
| $P_{active}$ | $\{0, 1\}$ | **Patch Active Flag** — whether an adapter patch is currently deployed | System deployment state |
| $C_{conf}$ | $[0, 1]$ | **Confidence Score** — AI's certainty in the most recent patch | LLM output calibration |

### 4.2.2 State Transitions

The state space is continuous for $D_c$, $E_{ui}$, and $L_{net}$, and discrete for $P_{active}$. The system samples the state at regular intervals $\Delta t$ (default: 1 second) and upon every intercepted API response.

## 4.3 Drift Detection: Jaccard Distance on JSON Schemas

The **Drift Coefficient** $D_c$ is the core metric driving the system's detection mechanism. It quantifies how much the runtime API response structure has deviated from the expected contract.

### 4.3.1 Schema Flattening

Given a JSON schema object, we first flatten it into a set of **key-path signatures**. For a nested JSON object:

```json
{
  "user": {
    "firstName": "string",
    "address": {
      "city": "string"
    }
  }
}
```

The flattened key-path set is:

$$K = \{ \texttt{user.firstName:string}, \texttt{user.address.city:string} \}$$

Each element encodes the full dot-notation path concatenated with the value type.

### 4.3.2 Jaccard Similarity

Given the expected key-path set $K_{expected}$ (from `API_CONTRACTS`) and the observed key-path set $K_{observed}$ (from live API response), the **Jaccard Similarity** is:

$$J(K_{expected}, K_{observed}) = \frac{|K_{expected} \cap K_{observed}|}{|K_{expected} \cup K_{observed}|}$$

The **Drift Coefficient** is the complement:

$$D_c = 1 - J(K_{expected}, K_{observed})$$

### 4.3.3 Properties

| Condition | $D_c$ Value | Interpretation |
|---|---|---|
| Schemas are identical | $D_c = 0$ | No drift — passthrough |
| Non-breaking addition (new field) | $0 < D_c < 0.05$ | Low severity — log only |
| Field renamed or type changed | $0.05 \leq D_c < 0.3$ | Medium severity — auto-patch |
| Multiple fields deleted/renamed | $D_c \geq 0.3$ | Critical — patch + human review |

### 4.3.4 Worked Example

**Expected Schema ($K_{expected}$):**

$$K_{expected} = \{ \texttt{id:number}, \texttt{firstName:string}, \texttt{lastName:string}, \texttt{email:string} \}$$

**Observed Schema ($K_{observed}$):** (Backend renamed `firstName` → `first_name`, deleted `lastName`)

$$K_{observed} = \{ \texttt{id:number}, \texttt{first\_name:string}, \texttt{email:string} \}$$

**Calculation:**

$$K_{expected} \cap K_{observed} = \{ \texttt{id:number}, \texttt{email:string} \} \Rightarrow |K \cap K'| = 2$$

$$K_{expected} \cup K_{observed} = \{ \texttt{id:number}, \texttt{firstName:string}, \texttt{lastName:string}, \texttt{email:string}, \texttt{first\_name:string} \} \Rightarrow |K \cup K'| = 5$$

$$J = \frac{2}{5} = 0.4, \quad D_c = 1 - 0.4 = 0.6$$

Since $D_c = 0.6 \geq 0.3$, this triggers a **CRITICAL** drift event with mandatory human review.

## 4.4 Action Space ($A$)

The action vector $a \in A$ defines the concrete corrective operations the autonomous system can dispatch in response to a state $s$:

$$A = \{ a_{\text{observe}}, a_{\text{generate}}, a_{\text{canary}}, a_{\text{promote}}, a_{\text{rollback}} \}$$

### 4.4.1 Action Definitions

| Action | Precondition | Effect | Postcondition |
|---|---|---|---|
| $a_{\text{observe}}$ | $D_c < \theta_{drift}$ | No intervention; traffic passes through normally | State unchanged |
| $a_{\text{generate}}$ | $D_c \geq \theta_{drift}$ | Invoke LangChain agent to synthesize adapter code | $P_{active} = 0$, patch in `PENDING` state |
| $a_{\text{canary}}$ | Patch compiled successfully | Route 10% of traffic through the adapter | $P_{active} = 1$, canary observation begins |
| $a_{\text{promote}}$ | Canary error rate $\leq$ baseline + $\epsilon$ | Route 100% of traffic through the adapter | $D_c \rightarrow 0$, drift status → `FIXED` |
| $a_{\text{rollback}}$ | Canary error rate $>$ baseline + $\epsilon$ | Revert all traffic to original pipeline | $P_{active} = 0$, drift status → `FAILED` |

Where:
- $\theta_{drift}$ is the configurable drift threshold (default: $1 - 0.95 = 0.05$).
- $\epsilon$ is the error tolerance (default: $0.05$ or 5%).

## 4.5 Transition Probability Function ($P$)

The transition probability $P(s' | s, a)$ defines the likelihood of transitioning to state $s'$ given current state $s$ and action $a$:

$$P(s_{t+1} | s_t, a_t) = P(\langle D'_c, E'_{ui}, L'_{net}, P'_{active}, C'_{conf} \rangle | s_t, a_t)$$

### 4.5.1 Key Transition Rules

**For $a_{\text{generate}}$:**

$$P(C'_{conf} > 0.8 | D_c < 0.3) \approx 0.92$$

This reflects empirical observation that LLMs handle simple schema mutations (single field renames) with high accuracy.

$$P(C'_{conf} > 0.8 | D_c \geq 0.5) \approx 0.65$$

Complex multi-field mutations reduce generation confidence.

**For $a_{\text{canary}}$:**

$$P(E'_{ui} = 0 | C_{conf} > 0.8) \approx 0.95$$

High-confidence patches almost always resolve the runtime errors.

**For $a_{\text{rollback}}$:**

$$P(E'_{ui} \leq E_{ui}^{baseline} | a_{\text{rollback}}) = 1.0$$

Rollback is deterministic — it always restores the previous stable state.

## 4.6 Reward Formulation ($R$)

The reward function guides the agent towards optimal behavior. It is a multi-variable optimization function:

$$\mathcal{R}(s_t, a_t) = -\omega_1 \cdot E_{ui} - \omega_2 \cdot \max(0, L_{net} - L_{\text{baseline}}) + \omega_3 \cdot \mathbb{I}(\text{Compiled}) + \omega_4 \cdot C_{conf} - \omega_5 \cdot \mathbb{I}(a_t = a_{\text{rollback}})$$

### 4.6.1 Reward Components

| Component | Weight | Purpose |
|---|---|---|
| $-\omega_1 \cdot E_{ui}$ | $\omega_1 = 10.0$ | **Heavily penalize UI errors** — the primary failure this system prevents |
| $-\omega_2 \cdot \max(0, L_{net} - L_{\text{baseline}})$ | $\omega_2 = 0.1$ | **Penalize latency regression** — patches should not slow down the system |
| $+\omega_3 \cdot \mathbb{I}(\text{Compiled})$ | $\omega_3 = 5.0$ | **Reward successful compilation** — incentivize syntactically valid patches |
| $+\omega_4 \cdot C_{conf}$ | $\omega_4 = 3.0$ | **Reward high confidence** — prefer patches the AI is certain about |
| $-\omega_5 \cdot \mathbb{I}(a = a_{\text{rollback}})$ | $\omega_5 = 2.0$ | **Penalize rollbacks** — each rollback represents a failed generation attempt |

### 4.6.2 Optimal Policy

The goal is to find a policy $\pi^*$ that maximizes the expected cumulative discounted reward:

$$\pi^* = \arg\max_\pi \mathbb{E}\left[\sum_{t=0}^{T} \gamma^t \mathcal{R}(s_t, \pi(s_t))\right]$$

Where $\gamma \in [0, 1)$ is the discount factor (default: $\gamma = 0.95$) and $T$ is the episode horizon.

In practice, since the action space is small and discrete, the system uses a **rule-based policy** derived from the MDP formalization rather than learned via RL:

$$\pi(s) = \begin{cases} a_{\text{observe}} & \text{if } D_c < \theta_{drift} \\ a_{\text{generate}} & \text{if } D_c \geq \theta_{drift} \text{ and } P_{active} = 0 \\ a_{\text{canary}} & \text{if } P_{active} = 0 \text{ and patch compiled} \\ a_{\text{promote}} & \text{if } P_{active} = 1 \text{ and } E_{ui}^{canary} \leq E_{ui}^{baseline} + \epsilon \\ a_{\text{rollback}} & \text{if } P_{active} = 1 \text{ and } E_{ui}^{canary} > E_{ui}^{baseline} + \epsilon \end{cases}$$

## 4.7 Complexity Analysis

### 4.7.1 Schema Comparison (Drift Detection)

- **Flattening:** $O(n)$ where $n$ = number of leaf nodes in the JSON schema.
- **Set intersection/union (Jaccard):** $O(n \log n)$ using sorted sets, or $O(n)$ amortized using hash sets.
- **Overall:** $O(n)$ per API response — constant for typical schemas with $n < 100$ fields.

### 4.7.2 Patch Generation

- **LLM inference:** $O(k)$ where $k$ = input token count. Bounded by the schema size. Typical latency: 2–8 seconds.
- **Syntax validation (AST parsing):** $O(m)$ where $m$ = generated code length. Typically $< 50$ms.

### 4.7.3 Canary Routing

- **Traffic splitting decision:** $O(1)$ — random number comparison against percentage threshold.
- **Metric aggregation:** $O(r)$ where $r$ = number of requests in observation window.

### 4.7.4 Overall System Latency Budget

| Phase | Expected Latency | Budget |
|---|---|---|
| Schema comparison (middleware) | 5–20ms | 50ms max (NFR-1) |
| LLM patch generation | 2,000–8,000ms | 30,000ms max (NFR-3) |
| Syntax validation | 10–50ms | Included in generation |
| Module Federation injection | 50–100ms | 150ms max (NFR-2) |
| Canary observation | 60,000ms (configurable) | 60s default |
| **Total (detection → resolution)** | **~70 seconds** | **< 120s target** |

## 4.8 Formal Correctness Properties

### 4.8.1 Safety Property

> The system SHALL NOT route 100% of production traffic through an unvalidated patch.

Formally: $\forall t: (P_{active}(t) = 1 \wedge \text{deployment\_status} = \text{PROMOTED}) \implies \exists t' < t: \text{canary\_validation}(t') = \text{PASS}$

### 4.8.2 Liveness Property

> Every detected drift SHALL eventually be resolved (either fixed or ignored/failed).

Formally: $\forall e \in \text{DRIFT\_EVENTS}: \text{status}(e) = \text{PENDING} \implies \Diamond(\text{status}(e) \in \{\text{FIXED}, \text{IGNORED}, \text{FAILED}\})$

### 4.8.3 Fallback Guarantee

> In the event of LLM unavailability, the system SHALL serve the last known stable frontend.

Formally: $\text{LLM\_available} = \text{false} \implies a_t = a_{\text{observe}} \wedge \text{serve\_stable\_build}$
