# GOAL.md — Alexandria

**Project:** Alexandria  
**AI Reading Companion:** Dria  
**Status:** Approved product direction, revised for AI-ready architecture  
**Last updated:** 2026-08-30

---

## 1. Vision

**Alexandria** คือ Public Reading Library สำหรับเก็บ อ่าน ค้นหา และจัดระเบียบเอกสาร HTML ที่สร้างโดยคนหรือ AI Agent

เป้าหมายไม่ใช่สร้าง “เว็บฝากไฟล์” แต่สร้าง **living knowledge library** ที่:

- Admin อัปโหลดและจัดระเบียบเอกสารได้ง่าย
- AI Agent อัปโหลดและอัปเดตเอกสารผ่าน MCP ได้
- คนทั่วไปเปิดอ่านจาก Stable URL ได้ทันทีโดยไม่ต้อง Login
- เอกสารอ่านได้ดีทั้ง Desktop และ Mobile
- รายงานเดิมอัปเดตได้โดย URL ไม่เปลี่ยนและมี Version History
- โครงสร้าง Category โตได้โดยไม่ hard-code
- ใน Phase 1.5 มี **Dria** เป็น AI Reading Companion สำหรับสรุป ถามจากเอกสาร ค้น Library และแนะนำสิ่งที่ควรอ่านต่อ
- ในอนาคตสามารถเติบโตเป็น Community Reading Room โดยไม่รื้อ document identity เดิม

North Star:

> **Upload once. Organize clearly. Read anywhere. Ask Dria when you need help understanding.**

---

## 2. Core Problem

AI Agent สามารถสร้าง HTML report ที่มีคุณภาพสูงได้แล้ว แต่ workflow หลังสร้างรายงานยังยุ่ง:

```text
Create HTML
→ move to repo
→ git commit
→ push
→ build
→ deploy
→ get URL
```

เมื่อเอกสารเพิ่มขึ้น ปัญหาก็เพิ่ม:

- หาเอกสารเก่ายาก
- Category ไม่สม่ำเสมอ
- report เดิมกลายเป็นหลายไฟล์
- link เก่าพังเมื่อย้ายที่
- Agent ต้องรู้เรื่อง Git/deploy ทั้งที่งานจริงคือ “publish document”
- ไม่มี Version History ที่เป็นระบบ
- ไม่มี Reading Companion ที่เข้าใจเนื้อหาใน Library โดยตรง

Alexandria ต้องลด flow ให้เหลือ:

```text
Admin / Agent
    ↓
Upload HTML
    ↓
Category + Tags
    ↓
Publish
    ↓
Stable Public URL
```

และใน Phase 1.5:

```text
Reader
   ↓
Ask Dria
   ↓
Document / Library knowledge
   ↓
Answer / Summary / Recommendation
```

---

# 3. Product Phases

## Phase 1 — Library Foundation

เป้าหมาย: ทำ Library ให้เร็ว ง่าย เสถียร และใช้งานจริงก่อน

### Phase 1 Features

- Public Library
- Browse + Metadata Search
- Dynamic Folder/Category Tree
- Tags
- Admin Password
- Admin Web Upload
- Agent MCP Upload
- Single `.html` file per version
- Stable Slug / Stable Public URL
- Version History
- Reader Shell
- Isolated iframe
- Responsive Library/Admin/Reader Shell
- External HTML resources allowed
- Cloudflare-first deployment

### Phase 1 Users

#### Public Reader

ทำได้:

- เปิด Library
- Browse Category
- Search
- อ่าน current document
- Share URL

ไม่ต้อง Login

#### Admin

ทำได้:

- Login ด้วย Admin Password
- Upload HTML
- Edit metadata
- Create/Rename/Move/Delete Category
- Manage Tags
- Update document
- View Version History
- Preview old version
- Restore
- Delete eligible old version
- Delete document

#### External AI Agent

เชื่อมผ่าน MCP + Agent API Key

ทำได้:

- upload document
- update document
- get/list/search documents
- update metadata
- move document to existing category
- list categories
- list/create tags

Agent ห้าม destructive/admin-only actions

---

## Phase 1.5 — Dria Reading Companion

**Dria** คือ AI ของ Alexandria

เป้าหมายไม่ใช่ Deep Research Agent แต่เป็น **Reading Companion ที่ใช้ความรู้ใน Alexandria ก่อน**

### Mode 1 — Ask This Document

Reader เปิดเอกสารแล้วถาม:

- “บทนี้พูดอะไร?”
- “Reverse DCF อธิบายยังไง?”
- “ผู้เขียนมอง ROIC กับ growth ต่างกันยังไง?”
- “สรุป 5 ประเด็นสำคัญ”
- “มี checklist อะไรที่นำไปใช้ได้บ้าง?”

Dria ต้อง retrieve จากเอกสารนั้นก่อนตอบ

### Mode 2 — Summarize

Quick Actions:

- Summary
- Key Ideas
- Explain Simply
- Actionable Takeaways
- Questions to Think About

### Mode 3 — Ask My Library

Dria สามารถค้นหลายเอกสารใน Alexandria เช่น:

- “มีอะไรพูดถึง Moat บ้าง?”
- “รายงานไหนพูดถึง ROIC + Reinvestment?”
- “เทียบแนวคิดในหนังสือสองเล่มนี้ให้ที”

### Mode 4 — Reading Recommendation

เช่น:

- “ถ้าอ่าน Expectations Investing แล้วควรอ่านอะไรต่อ?”
- “อยากเรียน valuation จากง่ายไปยาก”
- “มีเล่มไหนเกี่ยวกับ competitive advantage?”

Recommendation ต้องอธิบายเหตุผลจาก metadata/content ที่ Alexandria มี ไม่ควรแนะนำแบบสุ่ม

### Dria Source Modes

Dria ต้องแสดง scope ให้ชัด:

```text
This Document
My Library
Web (future)
```

Phase 1.5 มีเฉพาะ:

```text
This Document
My Library
```

**Web Research ไม่อยู่ใน Phase 1.5**

### Dria Free-first Goal

Dria ต้องออกแบบให้ใช้งานส่วนตัว/Community ขนาดเล็กได้ภายใน Cloudflare free allocation ให้มากที่สุด

ใช้:

- Cloudflare AI Search สำหรับ managed retrieval
- Workers AI เป็น free-first inference provider
- Cloudflare Agents SDK + Durable Objects สำหรับ conversation/state เมื่อเปิดใช้งาน Dria

Model ต้อง configurable ไม่ผูก business logic กับ model ใด model หนึ่ง

---

## Phase 2 — Community Reading Room

ยังไม่ implement

แนวคิด:

- Sign in with Google
- User profile
- Want to Read
- Reading
- Read
- Like/Favorite
- Recommend
- เห็นว่าใครอ่าน/อ่านแล้ว/ชอบ
- Community recommendation page

### Google Rule

ใช้ Google identity/OAuth สำหรับ Login เท่านั้นเป็นค่าเริ่มต้น

**Google Drive permission ไม่ควรถูกขอ** เว้นแต่ Phase ใหม่ต้องอ่าน/เขียน Drive จริง

---

## Phase 3 — Research Agent

ยังไม่ implement

อนาคต Dria อาจ:

- Search web
- ใช้ external MCP
- อ่าน external sources
- Deep Research
- Generate HTML report
- Publish report กลับเข้า Alexandria

Phase นี้มีต้นทุนและ security complexity สูงกว่า จึงแยกจาก Reading Companion ชัดเจน

---

# 4. Document Rules

## Single-file HTML

Phase 1 รองรับ:

```text
one document version = one .html file
```

HTML สามารถมี:

- inline CSS
- inline JS
- SVG
- table
- external images
- external fonts
- external CSS
- external JS/CDN

ไม่รองรับ:

- ZIP bundle
- folder upload
- separate local assets
- PDF/DOCX/Markdown ingestion

---

## Stable Identity

Document มี:

```text
document_id = permanent internal identity
slug        = stable public URL identity
version_id  = one immutable version
```

ตัวอย่าง:

```text
/docs/expectations-investing
```

เปลี่ยน Title / Category / Tags / HTML ได้

แต่ URL ไม่เปลี่ยนอัตโนมัติ

---

## Version History

การ update HTML:

```text
v1
↓
v2
↓
v3 current
```

Restore v1 เมื่อ current เป็น v3:

```text
v1
v2
v3
v4 ← restored from v1
```

Restore ต้อง append history ไม่ย้อน pointer ทับอดีต

---

# 5. Organization

## Dynamic Folder Tree

Admin เพิ่ม Category ได้เองในอนาคตโดยไม่แก้ code

ตัวอย่างเท่านั้น:

```text
Stocks
├── Thailand
│   ├── Consumer
│   └── Healthcare
├── US
└── China

Books
├── Investing
└── Business

Research
├── Macro
└── AI
```

Document:

- มี Primary Category 1 อัน
- มี Tags ได้หลายอัน

Category = “เก็บอยู่ที่ไหน”

Tags = “เกี่ยวกับอะไร”

---

# 6. Search

Phase 1 search จาก:

- Title
- Description
- Category
- Tags

ไม่ search เนื้อหา HTML

Phase 1.5 Dria ใช้ AI Search เป็นคนละ capability:

```text
Library Search
= deterministic metadata search

Dria Retrieval
= semantic/content retrieval
```

สองอย่างต้องไม่ถูกปนเป็น feature เดียว

---

# 7. Reader Experience

Public URL เปิด **Reader Shell**

Desktop:

```text
┌─────────────────────────────────────────────┐
│ ← Library   Document Title           Share │
├─────────────────────────────────────────────┤
│                                             │
│             isolated HTML iframe            │
│                                             │
└─────────────────────────────────────────────┘
```

เมื่อ Dria เปิดใช้งาน:

```text
┌──────────────────────────────┬──────────────┐
│                              │ Dria         │
│       HTML Document          │              │
│                              │ Ask...       │
│                              │ Summary      │
│                              │ Key Ideas    │
└──────────────────────────────┴──────────────┘
```

Mobile:

```text
← Title                  Share
──────────────────────────────
        HTML content

             [ ✦ Ask Dria ]
```

Dria เปิดเป็น drawer/bottom sheet

---

# 8. Security Principles

## Public Read, Controlled Write

Public:

```text
read only
```

Write:

```text
Admin
Authorized Agent
```

## HTML Isolation

HTML ที่ upload อาจมี arbitrary JavaScript

ดังนั้น:

> Uploaded HTML must never share the Admin security context.

ใช้:

- separate content origin
- sandboxed iframe
- no Admin token in iframe URL
- CORS deny credentialed Admin calls from content origin

แม้เราจะ trust uploader แต่ไม่ trust arbitrary embedded script

---

# 9. Phase 1 Non-goals

ห้ามเพิ่มเอง:

- Google Login
- public accounts
- community
- likes
- reading status
- comments
- recommendations feed
- semantic search in normal Library search
- HTML editor
- asset bundles
- web research
- background research agent
- payments
- analytics product

---

# 10. Success Criteria

Phase 1 สำเร็จเมื่อ:

- Admin upload `.html` จาก Web ได้
- Agent upload ผ่าน MCP ได้
- Publish แล้วได้ Stable Public URL
- Public อ่านได้โดยไม่ Login
- HTML ตัวอย่าง render ใน iframe ได้
- External resources ใช้งานได้
- Mobile Reader ใช้งานได้
- Category เพิ่มจาก Admin ได้โดยไม่แก้ code
- Metadata Search ใช้งานได้
- Update ผ่าน slug สร้าง Version ใหม่
- URL ไม่เปลี่ยน
- Restore append version ใหม่
- Agent ไม่มี destructive tools
- secret ไม่อยู่ใน client bundle/repo

Phase 1.5 Dria สำเร็จเมื่อ:

- Ask This Document retrieve จาก document ปัจจุบัน
- Summary ใช้ content ของ Alexandria จริง
- Ask My Library ค้นหลาย document ได้
- Recommendation มี source/reason ที่ตรวจสอบได้
- User เห็นชัดว่าคำตอบมาจาก This Document หรือ My Library
- Model/provider เปลี่ยนได้โดยไม่แก้ Domain layer
- เมื่อ free AI quota หมด ระบบ fail gracefully ไม่ทำให้ Library ใช้งานไม่ได้

---

# 11. Product Principle

Alexandria Foundation:

> **Store → Organize → Read → Update**

Dria:

> **Retrieve → Understand → Explain → Recommend**

Research Agent:

> **Discover → Investigate → Create → Publish**

ห้ามข้ามลำดับ maturity นี้โดยไม่ได้รับ approval
