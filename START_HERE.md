# START_HERE.md — Alexandria

# Alexandria คืออะไร?

**Alexandria** คือระบบคลังเอกสาร HTML สำหรับเก็บ จัดหมวดหมู่ ค้นหา อ่าน และอัปเดตเอกสารจากคนหรือ AI Agent

แนวคิดหลักคือทำให้เอกสารที่สร้างจาก AI หรือจากงานวิจัยต่าง ๆ ไม่ต้องกระจัดกระจายอยู่หลายที่ และไม่ต้องผ่านขั้นตอน Git / Deploy ทุกครั้งที่ต้องการเผยแพร่เอกสารใหม่

เป้าหมายคือ:

> **สร้างครั้งเดียว → จัดเก็บเป็นระบบ → เปิดอ่านได้ทุกที่ → อัปเดตได้โดยลิงก์เดิมไม่เปลี่ยน**

ในอนาคต Alexandria จะมี AI Reading Companion ชื่อ **Dria** สำหรับช่วยสรุป ถามคำถามจากเอกสาร และแนะนำสิ่งที่ควรอ่านต่อ

---

# สิ่งที่ Alexandria จะทำในเวอร์ชันแรก

Phase 1 เน้นสร้างระบบ Library ให้ใช้งานได้จริงก่อน

ความสามารถหลัก:

- เก็บเอกสาร HTML แบบไฟล์เดียว
- เปิดอ่านได้จาก Public URL โดยไม่ต้อง Login
- รองรับ Mobile และ Desktop
- ค้นหาเอกสารจาก Title / Description / Category / Tags
- จัด Category แบบ Folder Tree ได้หลายชั้น
- ใช้ Tags ได้หลายรายการต่อเอกสาร
- Admin อัปโหลดและจัดการเอกสารจากหน้าเว็บ
- AI Agent อัปโหลดและอัปเดตเอกสารผ่าน MCP
- เอกสารมี Stable URL
- อัปเดตเอกสารแล้วเก็บ Version History
- เรียกดูหรือ Restore Version เก่าได้
- แยก HTML ที่อัปโหลดออกจากระบบ Admin ด้วย iframe/security origin

---

# Dria คืออะไร?

**Dria** คือ AI Reading Companion ของ Alexandria

Dria ยังไม่ใช่เป้าหมายของ Phase 1 แต่ระบบถูกออกแบบให้รองรับตั้งแต่ต้นโดยไม่ต้องรื้อ Architecture ภายหลัง

Phase 1.5 ตั้งใจให้ Dria ทำได้:

- สรุปเอกสารที่กำลังอ่าน
- ตอบคำถามจากเอกสารนั้น
- อธิบายแนวคิดให้ง่ายขึ้น
- ค้นข้อมูลจากเอกสารหลายชิ้นใน Alexandria
- แนะนำหนังสือหรือรายงานที่เกี่ยวข้อง

Dria ต้องแยกขอบเขตของข้อมูลให้ชัด เช่น:

- **This Document** — ตอบจากเอกสารที่กำลังอ่าน
- **My Library** — ค้นจาก Alexandria ทั้ง Library
- **Web** — เป็นความสามารถในอนาคต ไม่อยู่ใน Phase 1.5

---

# โครงสร้างโปรเจกต์

Starter Pack นี้มีเอกสารหลักดังนี้:

```text
alexandria/
├── START_HERE.md
├── CLAUDE.md
├── GOAL.md
├── SPEC.md
├── TECHSTACK.md
├── AGENT.md
├── GRAPH_ENGINEER_OPUS_PROMPT.md
├── IMPLEMENTATION_PLAN_TEMPLATE.md
│
└── .claude/
    └── agents/
        └── sonnet-executor.md
```

เมื่อเริ่มวางแผน Implementation แล้ว จะมีไฟล์เพิ่ม:

```text
IMPLEMENTATION_PLAN.md
```

---

# แต่ละไฟล์ใช้ทำอะไร?

## `START_HERE.md`

ไฟล์ที่คุณกำลังอ่าน

ใช้สำหรับ:

- เข้าใจว่าโปรเจกต์นี้คืออะไร
- รู้ว่าแต่ละไฟล์มีหน้าที่อะไร
- เข้าใจ Phase ของระบบ
- ส่งต่อโปรเจกต์ให้คนอื่นอ่านต่อได้ง่าย

ไฟล์นี้ **ไม่ใช่ System Prompt ของ AI**

---

## `GOAL.md`

อธิบาย:

> “เรากำลังสร้างอะไร และทำไมถึงสร้าง”

มี:

- Vision
- Problem
- User Roles
- Phase 1
- Dria Phase 1.5
- Community Phase 2
- Research Agent Phase 3
- Non-goals
- Success Criteria

ถ้าต้องการเข้าใจ Product ให้เริ่มจากไฟล์นี้

---

## `SPEC.md`

อธิบาย:

> “ระบบต้องทำงานอย่างไร”

มีรายละเอียด:

- Architecture
- Data Model
- API
- Versioning
- Stable Slug
- Category / Tags
- Admin
- MCP
- Reader
- iframe Security
- Dria behavior
- Testing
- Definition of Done

เป็นเอกสารหลักสำหรับ Developer

---

## `TECHSTACK.md`

อธิบาย Technology ที่เลือกใช้และเหตุผล

Stack หลัก:

```text
React
Vite
React Router
Tailwind CSS
TypeScript

Cloudflare Workers
Hono
D1
R2

MCP SDK

Dria:
Cloudflare Agents SDK
Durable Objects
AI Search
Workers AI
```

ไฟล์นี้ตอบคำถามว่า:

> “ทำไมเลือกเทคนี้ และแต่ละตัวมีหน้าที่อะไร”

---

## `AGENT.md`

เป็นกฎสำหรับ AI Coding Agent / Developer

เช่น:

- ห้ามเปลี่ยน Stable Slug
- Version ต้อง Immutable
- Agent ห้ามลบเอกสาร
- Category Structure เป็นสิทธิ์ Admin
- HTML ต้องอยู่ใน isolated iframe
- Dria ต้องไม่ทำให้ Library พังเมื่อ AI ใช้งานไม่ได้
- Phase 1 ต้องมาก่อน Phase 1.5

ไฟล์นี้เป็น Development Guardrail

---

## `CLAUDE.md`

ใช้สำหรับ Claude Code

ปัจจุบันตั้งให้ import:

```text
@AGENT.md
```

เพื่อให้ Claude Code โหลดกฎของโปรเจกต์เข้า context โดยอัตโนมัติ

คนทั่วไปไม่จำเป็นต้องแก้ไฟล์นี้

---

## `GRAPH_ENGINEER_OPUS_PROMPT.md`

เป็น Prompt สำหรับ **Opus**

หน้าที่ของ Opus:

```text
Requirement Discovery
→ Design
→ Implementation Plan
→ Dependency Graph
→ Definition of Done
→ Orchestration
→ Review
```

Opus ไม่ควรเป็น Executor หลัก

เมื่อ Plan ได้รับการอนุมัติ Opus จะ dispatch งานเป็น Node ให้ Sonnet

---

## `.claude/agents/sonnet-executor.md`

เป็น Custom Subagent สำหรับ Claude Code

กำหนดให้ใช้:

```text
model: sonnet
```

Sonnet ทำหน้าที่:

```text
รับ Graph Node
→ Implement
→ Test
→ Verify DoD
→ ส่ง Evidence กลับ Opus
```

Sonnet ไม่ควรขยาย Scope หรือเลือก Node ถัดไปเอง

---

## `IMPLEMENTATION_PLAN_TEMPLATE.md`

เป็น Template สำหรับให้ Opus สร้าง:

```text
IMPLEMENTATION_PLAN.md
```

หลังจาก Requirement และ Design ผ่านการ Approve แล้ว

Implementation Plan จริงควรมี:

- Dependency Graph
- Nodes
- Critical Path
- Parallel Tasks
- High-risk Nodes
- Tests
- Verification
- Definition of Done
- Graph State

---

# Workflow การพัฒนา

ภาพรวม:

```text
Human
  │
  ▼
Opus
  │
  ├─ ทำความเข้าใจ Requirement
  ├─ ถามคำถามทีละข้อ
  ├─ เสนอ Design
  │
  ▼
Human Approve Design
  │
  ▼
Opus
  │
  ├─ สร้าง IMPLEMENTATION_PLAN.md
  ├─ แตก Dependency Graph
  └─ กำหนด DoD
  │
  ▼
Human Approve Plan
  │
  ▼
Opus Graph Orchestrator
  │
  ├──── Sonnet Executor
  ├──── Sonnet Executor
  └──── Sonnet Executor
          │
          ▼
     Code + Tests + Evidence
          │
          ▼
       Opus Review
```

---

# ทำไมต้องแบ่ง Opus และ Sonnet?

เราใช้โมเดลต่างกันตามหน้าที่

## Opus

เหมาะกับ:

- Requirement
- Architecture
- Planning
- Dependency reasoning
- Risk
- Reviewing
- Global context

จึงเป็น:

> **Graph Architect / Orchestrator**

## Sonnet

เหมาะกับ:

- Coding
- Test
- Implementation
- ทำงานตาม Scope ที่ชัด

จึงเป็น:

> **Graph Node Executor**

แนวทางนี้ช่วยลดการใช้ Opus กับงานที่ไม่จำเป็น และทำให้ Node แต่ละงานมี Scope ชัดเจน

---

# Graph Engineer คืออะไรในโปรเจกต์นี้?

แทนที่จะคิดว่า:

> “Feature ต่อไปต้องเขียนอะไร?”

เราคิดว่า:

> “Node ไหนพร้อมทำแล้ว และ Node ไหนยังติด Dependency?”

ตัวอย่าง:

```text
Database
   │
   ▼
Domain Services
   │
   ├───────────┐
   ▼           ▼
Public API   Admin API
   │           │
   ▼           ▼
Library      Admin UI
```

ถ้า Node สองตัวไม่ขึ้นต่อกัน สามารถทำ Parallel ได้

ถ้ามี Dependency ต้องทำตามลำดับ

---

# Approval Gates

มี Approval หลัก 2 ครั้ง

## Gate 1 — Design Approval

ก่อน Implementation Plan

```text
Requirements
→ Design
→ Human Approve
```

## Gate 2 — Implementation Plan Approval

```text
Graph
→ Nodes
→ Tests
→ DoD
→ Human Approve
```

ก่อน Gate 2 ผ่าน:

> ห้ามเริ่ม Implementation

---

# หากคุณเป็น Developer คนใหม่

แนะนำอ่านตามลำดับ:

```text
1. START_HERE.md
2. GOAL.md
3. SPEC.md
4. TECHSTACK.md
5. AGENT.md
```

จากนั้นดู:

```text
IMPLEMENTATION_PLAN.md
```

ถ้ามีแล้ว

---

# หากคุณเป็น Product Owner

อ่าน:

```text
START_HERE.md
GOAL.md
```

แล้วใช้ `SPEC.md` เมื่อต้องดู behavior ละเอียด

---

# หากคุณใช้ Claude Code

อ่าน `START_HERE.md` ให้เข้าใจก่อน

จากนั้นใช้:

```text
GRAPH_ENGINEER_OPUS_PROMPT.md
```

เป็น workflow ของ Main Opus session

Claude Code จะใช้:

```text
.claude/agents/sonnet-executor.md
```

สำหรับ implementation เมื่อ Opus dispatch Node

---

# Product Roadmap

```text
Phase 1
Alexandria Library
│
├─ Public Library
├─ Reader
├─ Admin
├─ MCP
├─ Categories / Tags
├─ Version History
└─ Stable URLs

        ↓

Phase 1.5
Dria
│
├─ Ask This Document
├─ Summarize
├─ Ask My Library
└─ Recommend Reading

        ↓

Phase 2
Community
│
├─ Google Login
├─ Reading Status
├─ Likes
└─ Recommendations

        ↓

Phase 3
Research Agent
│
├─ Web
├─ External MCP
├─ Deep Research
└─ Publish Reports
```

---

# หลักการสำคัญที่สุด

Alexandria:

> **Store → Organize → Read → Update**

Dria:

> **Retrieve → Understand → Explain → Recommend**

Graph Engineering:

> **Plan globally → Execute locally → Verify with evidence**

เป้าหมายไม่ใช่ทำระบบให้ซับซ้อนที่สุด

แต่คือสร้าง Library ที่เรียบง่าย ใช้งานจริงได้ และสามารถเติบโตเป็น Knowledge System ที่มี AI อยู่ข้างในได้โดยไม่ต้องรื้อระบบใหม่
