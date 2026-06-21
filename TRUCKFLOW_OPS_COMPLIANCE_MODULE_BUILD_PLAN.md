# TRUCKFLOW_OPS_COMPLIANCE_MODULE_BUILD_PLAN

**Status**: Design only — no code, no DB, no UI changes
**Date**: 2026-06-18
**App state**: v0.5.1 — verify-seed 85/85

---

## Current Office Sidebar

  Office
    Expenses
    Staff
    Vendors
    Equipment
    Tasks

Target sidebar after Compliance build:

  Office
    Vendors
    Compliance
    Staff
    Expenses

---

## 1. What Is a Compliance Record?

A Compliance record tracks any legal, regulatory, or operational obligation
that has a cost, an issuer, and a date that must be monitored.

Examples for a food truck operation:
  Oregon Food Handler License (staff-level)
  Mobile Food Unit Permit (business-level)
  Oregon Department of Agriculture Certification
  General Liability Insurance
  Vehicle Registration (truck)
  Lincoln County Business License
  NSF Equipment Certification
  Health Department Inspection approval
  Propane Safety Inspection
  Costco Business Membership (currently tracked on vendor)

Key operational questions answered by the module:
  What expires in the next 30 days?
  What is already expired?
  How much does annual compliance cost in total?
  What needs to be renewed and when?

---

## 2. Recommended DB Schema

Table: compliance

  id                 SERIAL PRIMARY KEY
  name               TEXT NOT NULL              -- e.g. "Mobile Food Unit Permit"
  category           TEXT                       -- License / Permit / Certification / Insurance /...
  issuer             TEXT                       -- e.g. "Oregon Department of Agriculture"
  license_number     TEXT                       -- permit/certificate/policy number
  cost               NUMERIC DEFAULT 0          -- original issue cost
  renewal_cost       NUMERIC DEFAULT 0          -- cost to renew
  issue_date         DATE                       -- date first issued
  expiration_date    DATE                       -- date it expires (NULL = no expiration)
  renewal_period     TEXT                       -- e.g. "Annual", "2 years", "Monthly"
  auto_renew         BOOLEAN DEFAULT false
  status             TEXT DEFAULT 'Active'    -- Active / Expired / Expiring Soon / No Expiration
  notes              TEXT
  active             BOOLEAN DEFAULT true       -- soft-hide without deleting
  created_at         TIMESTAMPTZ DEFAULT NOW()

Notes on schema decisions:
  status is a computed-friendly field but stored for manual override.
  license_number chosen over identification_number (more intuitive for ops).
  renewal_period is free-text (Annual, 2 years, Monthly) — not an enum.
  No foreign key constraints — compliance records are standalone.
  active flag allows archiving expired records without deletion.

---

## 3. Status Rules

Computed from expiration_date at read time (overview.js + client-side):

| Condition | Status | Badge Color |
|---|---|---|
| expiration_date IS NULL | No Expiration | Muted gray #a1a1aa |
| expiration_date < today | Expired | Red #fca5a5 |
| expiration_date <= today + 30 | Expiring Soon | Yellow #fde68a |
| expiration_date > today + 30 | Active | Green #86efac |

30-day window matches vendor membership alert pattern already in production.

Stored status field: updated by overview.js enrichment or manual override.
Client-side badge: always recomputed from expiration_date (authoritative).

---

## 4. Today Page Integration

Same pattern as membershipAlerts in overview.js (already proven):

  const complianceAlerts = complianceRows
    .filter(c => c.active && c.expiration_date)
    .map(c => {
      const exp = new Date(c.expiration_date); exp.setHours(0,0,0,0);
      const daysLeft = Math.ceil((exp - today) / 86400000);
      if (exp < today)
        return { level: 'Critical', title: ,
                 detail: ,
                 action: 'Renew immediately' };
      if (exp <= in30)
        return { level: 'Warning', title: ,
                 detail: ,
                 action: 'Schedule renewal' };
      return null;
    }).filter(Boolean);

Compliance alerts inserted BEFORE membershipAlerts in insights array.
Both share the same 30-day window and Critical/Warning level scheme.

Auto-renew items: if auto_renew=true AND status=Expiring Soon, insight
downgrades from Warning to Info with note "Auto-renewal enabled".

---

## 5. Compliance Page UI

### Page header
  Title: Compliance
  Count: N records
  Filters: All / Active / Expiring / Expired (segmented toggle)
  Search: name, category, issuer
  Add button: Add Record

### Collapsed card (default)
  Row 1: name (bold) + category badge (color-coded) + status badge
  Row 2: issuer (muted) + expiration date
  Row 3: renewal cost if > 0
  Chevron expand

### Expanded card
  Basic section:
    issuer, license_number, renewal_period, auto_renew
  Dates section:
    issue_date, expiration_date, days until expiry
  Cost section:
    cost (original), renewal_cost
  Notes
  Edit / Delete actions

### Category badge colors
  License:         blue    rgba(59,130,246,.2)  #93c5fd
  Permit:          orange  rgba(249,115,22,.18) #fed7aa
  Certification:   teal    rgba(20,184,166,.18) #99f6e4
  Insurance:       purple  rgba(168,85,247,.18) #d8b4fe
  Registration:    gray    rgba(255,255,255,.08)#a1a1aa
  Membership:      green   rgba(34,197,94,.18)  #86efac
  Inspection:      yellow  rgba(234,179,8,.18)  #fde68a
  Other:           gray    rgba(255,255,255,.08)#a1a1aa

---

## 6. Add/Edit Form Fields

Section: Basic
  name (required)
  category (dropdown: License/Permit/Certification/Insurance/Registration/Membership/Inspection/Other)
  issuer (text)
  license_number (text, label changes by category)
  active (checkbox)

Section: Dates
  issue_date (date)
  expiration_date (date, optional)
  renewal_period (text: Annual/2 years/Monthly/etc.)
  auto_renew (checkbox)

Section: Cost
  cost (number, original issue cost)
  renewal_cost (number)

Section: Notes
  notes (textarea)

Validation:
  name required
  expiration_date if set must be a valid date
  cost/renewal_cost >= 0

---

## 7. Future Document Attachment Support

Design only — no file upload in this build.

Recommended approach when ready:

Table: compliance_documents
  id               SERIAL PK
  compliance_id    INTEGER FK -> compliance.id ON DELETE CASCADE
  filename         TEXT NOT NULL
  file_path        TEXT NOT NULL     -- server-side path or S3 key
  file_size        INTEGER
  mime_type        TEXT
  uploaded_at      TIMESTAMPTZ DEFAULT NOW()

Storage options:
  Phase A: local filesystem (/home/chancesr/birria-fusion-ops/uploads/)
  Phase B: S3 bucket (birria-ops-docs) with presigned URLs

UI when ready:
  Expanded card shows paperclip icon + "Attach" button
  Uploaded files listed with download link
  File types accepted: PDF, JPG, PNG (permits, certificates, insurance cards)

This is a non-blocking feature — compliance module is fully useful without it.

---

## 8. Relationship to Vendor Membership

Current state:
  Vendor membership is tracked on the suppliers table:
  membership_required, membership_number, membership_expiration
  Costco is the primary use case.

Recommendation: Keep vendor membership fields where they are for now.

Rationale:
  The vendor membership fields were just built and are working correctly.
  Membership alerts already appear on the Today page via membershipAlerts.
  Moving them to Compliance immediately would require a migration, seed update,
  and verify-seed changes before any new value is delivered.

Future migration path (optional, Phase 4+):
  When Compliance module is stable, optionally mirror membership-required vendors
  into Compliance as category=Membership via a seed/migration script.
  The vendor fields stay as the source of truth; Compliance gets a read-only copy.
  Or: deprecate vendor membership fields and use Compliance as primary.
  Decision deferred until the owner sees both in use.

No data loss in either path — both tables are additive.

---

## 9. Implementation Phases

**Phase 1 — Schema (DB + seed + verify-seed)**
  CREATE TABLE compliance with all columns
  Update init.js
  Seed 4-5 example records:
    Mobile Food Unit Permit (Annual, Lincoln County)
    Oregon Food Handler Cert (Annual, ODA)
    General Liability Insurance (Annual)
    Vehicle Registration (Annual)
    Propane Inspection (Annual)
  Update verify-seed.js: compliance count assertion + status check
  Estimated effort: 30 min

**Phase 2 — Backend (overview.js + crud.js)**
  Add compliance query to buildOverview() Promise.all
  Add complianceAlerts to insights (above membershipAlerts)
  Add compliance to overview.data
  Add compliance to crud.js tableMap + writableFields
  Estimated effort: 30 min

**Phase 3 — Frontend UI**
  Add compliance to navGroups Office section (after Vendors)
  Add ShieldCheck or FileCheck icon for Compliance
  Build CompliancePage + ComplianceCard (collapse/expand)
  Build ComplianceModal (4 sections: Basic/Dates/Cost/Notes)
  Add compliance routing to App.jsx
  Exclude from Collection fallthrough
  Estimated effort: 2 hours

**Phase 4 — Polish + Reporting**
  Annual compliance cost total in page header
  Compliance count by status in header summary row
  Filter toggle: All / Active / Expiring / Expired
  Print/export compliance list
  Optionally mirror vendor memberships into Compliance
  Document attachment (Phase A: local filesystem)
  Estimated effort: 1-2 hours

---

## 10. Rollback Considerations

| Phase | Schema change | Risk | Rollback |
|---|---|---|---|
| 1 (CREATE TABLE) | New table | Zero | DROP TABLE compliance |
| 2 (overview/crud) | None | Zero | Revert commits |
| 3 (frontend UI) | None | Zero | Remove component + routing |
| 4 (polish) | None | Zero | Revert commits |
| Future: doc attachments | New table | Low | DROP TABLE compliance_documents |
| Future: membership migration | Data move | Low | Restore from backup |

All phases are additive. No existing tables modified.
Full rollback at any phase leaves production in valid state.
The compliance table has no FK dependencies on other tables
(standalone records — no cascade risk).

---

## Summary

Compliance module is the cleanest possible next feature:
  New table (no migration of existing data)
  Proven patterns from vendor membership alerts
  Same card expand/collapse pattern as VendorCard, MenuCard, RecipeCard
  Same overview.js insights pattern already in use
  No FKs — zero cascade risk
  Rollback at any phase = zero data loss

Recommended build order:
  Phase 1 -> Phase 2 -> Phase 3 -> Phase 4
  Each phase is a single commit.
  Total estimated effort: ~4 hours.
