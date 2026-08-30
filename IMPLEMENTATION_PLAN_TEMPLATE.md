# IMPLEMENTATION_PLAN_TEMPLATE.md

> Template สำหรับ Opus Graph Architect  
> ห้ามใช้เป็น execution plan โดยตรง  
> หลัง Design Approved ให้สร้าง `IMPLEMENTATION_PLAN.md`

# Implementation Plan

## Metadata

```text
Project:
Plan Version:
Created:
Planner: Opus Graph Architect
Status: DRAFT | REVIEW | APPROVED | EXECUTING | COMPLETE
Approved By:
Approved At:
```

## 1. Goal

Outcome ของ implementation รอบนี้

## 2. Scope

- ...

## 3. Non-Goals

- ...

## 4. Source-of-Truth References

```text
GOAL.md:
SPEC.md:
TECHSTACK.md:
AGENT.md:
```

## 5. Architecture Constraints

Non-negotiable:

- ...

## 6. Requirement Traceability

| Requirement | Source | Node(s) / Non-Goal | Verification |
|---|---|---|---|
| ... | SPEC §... | G... | ... |

ทุก Requirement สำคัญต้องอยู่ในตาราง

## 7. Execution Graph

```text
G0 ...
├── G1 ...
│   ├── G1.1 ...
│   └── G1.2 ...
├── G2 ...
└── G3 ...
```

## 8. Critical Path

```text
G0 → G1 → G2 → ...
```

เหตุผล: ...

## 9. Parallel Candidates

```text
G2.1 || G2.2
```

เหตุผลที่ safe:

- ...

Conflict analysis:

- ...

## 10. High-Risk Nodes

| Node | Risk | Why | Extra Verification |
|---|---|---|---|
| ... | High | ... | ... |

## 11. Checkpoints

### CHECKPOINT A — ...

Required Nodes:

```text
...
```

Gate DoD:

- [ ] ...

### RELEASE GATE

- [ ] ...

## 12. Graph State Summary

| Node | Status | Depends On | Blocks | Parallel With |
|---|---|---|---|---|
| G0 | READY | — | G1 | — |

Allowed:

```text
BLOCKED
READY
IN_PROGRESS
REVIEW
DONE
FAILED
```

---

# Node Template

## Node Gx.y — [Name]

### Status

```text
BLOCKED | READY | IN_PROGRESS | REVIEW | DONE | FAILED
```

### Goal

หนึ่ง outcome ที่ชัดเจน

### Why

ทำไม Node นี้จำเป็น

### Dependencies

```text
depends_on:
- G...

blocks:
- G...

can_parallel_with:
- G...
```

### Scope

- ...

### Out of Scope

- ...

### Read First

- `SPEC.md` §...
- `TECHSTACK.md` §...
- `path/to/existing/file`

### Files

Create:

- `path`

Modify:

- `path`

Read:

- `path`

ถ้าต้องแก้ไฟล์นอก boundary อย่างมีนัยสำคัญ ให้ STOP/report

### Interfaces / Contracts

Consumes:

```text
...
```

Produces:

```text
...
```

Must not change:

```text
...
```

### Implementation Requirements

1. ...
2. ...

### Edge Cases

- ...

### Tests Required

Positive:

- ...

Negative:

- ...

Regression:

- ...

### Verification Commands

```bash
# exact command
```

Expected:

```text
exit 0
...
```

### Definition of Done

- [ ] exact measurable outcome
- [ ] required tests pass
- [ ] relevant security/contract verification passes
- [ ] no out-of-scope implementation
- [ ] docs updated if behavior changed

### Stop Conditions

STOP และส่งกลับ Opus ถ้า:

- requirement conflict
- dependency incomplete
- architecture change needed
- schema/interface change outside scope
- security implication discovered
- DoD cannot be verified

### Suggested Commit

```text
type(scope): summary
```

### Evidence

> Executor fills / Opus verifies

Changed:

```text
...
```

Tests:

```text
...
```

Verification:

```text
...
```

Notes:

```text
...
```

---

## 13. Integration Nodes

ระบุ Node ที่รวม parallel work หรือ verify cross-node contracts

## 14. Deployment / Migration Order

ถ้ามี:

1. ...
2. ...

Rollback / compensation:

- ...

## 15. Final Phase Verification

Requirements:
- [ ] ...

Architecture:
- [ ] ...

Security:
- [ ] ...

Tests:
- [ ] ...

Build:
- [ ] ...

Mobile:
- [ ] ...

Integration:
- [ ] ...

MCP:
- [ ] ...

Deployment:
- [ ] ...

## 16. Plan Self-Review

ก่อนขอ User Approval:

- [ ] ทุก requirement map ไป Node หรือ Non-Goal
- [ ] ไม่มี dependency cycle
- [ ] critical path สมเหตุผล
- [ ] parallel candidates ไม่มี obvious conflict
- [ ] ทุก Node independently reviewable
- [ ] ทุก Node มี measurable DoD
- [ ] ทุก Node มี verification command/strategy
- [ ] risky Nodes มี negative tests
- [ ] ไม่มี TODO/TBD/placeholder
- [ ] future phase ไม่หลุดเข้ามา
- [ ] ยังไม่มี implementation ก่อน approval

## 17. Approval

```text
PLAN STATUS: REVIEW
```

Planner ต้องถาม:

> Approve Implementation Plan นี้หรือไม่?

Implementation ห้ามเริ่มจน Status = `APPROVED`
