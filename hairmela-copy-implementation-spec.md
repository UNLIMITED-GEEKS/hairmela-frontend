# HairMela Landing Page: Copy Implementation Spec

**For:** Developer implementing copy changes on hairmela.com homepage
**Scope:** Copy and section-order changes only. No visual redesign, no new components except where marked NEW. Existing styles, buttons, and layout patterns are reused.
**Rule for all copy:** Paste text exactly as written inside the code blocks. Do not add em dashes, do not rephrase, do not change capitalization or punctuation.

---

## Page structure (new order, top to bottom)

1. Navigation (unchanged)
2. Hero, owner-facing (REPLACES current hero copy)
3. Find a salon: search + filters + salon cards (MOVED below hero, new header line added)
4. How it works (copy replaced, same 3-step layout, one NEW line added)
5. Proof section (NEW section)
6. CTA section (copy replaced)
7. PWA banner (copy replaced)
8. Footer (unchanged)

The only structural changes are: hero copy swapped, search block gets a header line, one new line under step 3, and one new section (Proof) inserted between How it works and the CTA. Everything else is copy replacement in place.

---

## 1. Navigation

No changes. Keep: HairMela logo, About, Get the app, Contact, Pricing, Sign In, Sign Up.

---

## 2. Hero (owner-facing) — REPLACE

**Location:** Top of page, where the current hero sits.

**Remove this copy:**
- H1: "Skip the wait. Join the queue from your phone."
- Subhead: "HairMela lets customers join their barber's live queue and track their position in real time — no app download needed."

**Replace with:**

H1:
```
Stop losing walk-ins to the wait.
```

Subhead (single paragraph, two sentences):
```
Your queue, in your pocket. Know who's next, how long each cut takes, and who's on the way before they walk in.
```

Buttons (side by side, primary then secondary):
- Primary button (same style as current Sign Up button):
```
Create a free account
```
Links to: sign-up page.
- Secondary button (outline/ghost style, same as current Sign In button):
```
See how it works
```
Links to: anchor scroll to the How it works section (`#how-it-works`).

Small text line directly under the buttons (muted/gray, small font):
```
Free to start. Set up in minutes.
```

**Note:** No accent-color word in the new H1 (the current hero styles "Join the queue" in maroon). If a maroon accent is wanted for visual continuity, apply it to the words "walk-ins" only.

---

## 3. Find a salon (customer search block) — MOVE + ADD HEADER

**Location:** Directly below the new hero. This is the existing search bar, category filter pills, and salon cards. Keep all of it functionally identical.

**Add one header line above the search bar** (H2 or styled subhead, centered like current section headers):
```
Getting a cut today? See the line before you go.
```

**Keep unchanged:**
- Search placeholder: `Search for a salon`
- Filter pills: All, Beard Cut, Haircut, Braids & Locs, Hair Styling, Nails, Spa & Massage, Makeup, Skincare
- Salon cards (Superstar barbershop, Ace Cut, etc.) exactly as rendered now, including Open/Closed badges and locations.

---

## 4. How it works — REPLACE COPY, KEEP LAYOUT

**Location:** Same position and same 3-column, numbered layout as current. Add id `how-it-works` to this section so the hero's secondary button can anchor to it.

Section H2 (unchanged):
```
How it works
```

Section subhead — **remove** "Three steps from setup to serving customers — no hardware required." **Replace with:**
```
Three steps from setup to a calmer salon. No hardware, no training, no stress.
```

**Step 1** title:
```
Set up in minutes
```
Step 1 body:
```
Add your salon, your barbers, and your services. That's it.
```

**Step 2** title:
```
Run your queue
```
Step 2 body:
```
Add walk-ins, call the next client, and see how long each cut takes. All from your phone.
```

**Step 3** title:
```
Let clients join from anywhere
```
Step 3 body:
```
Put your QR code on the wall. Clients check the line before they leave home and show up right on time.
```

**NEW: reassurance line.** Add one centered line below the 3-step grid, inside the same section, in the muted subhead style:
```
And it works from day one. Even if nobody scans the code, you've already replaced the notebook.
```

---

## 5. Proof section — NEW SECTION

**Location:** Insert between How it works and the CTA section ("Ready to run..."). Alternate the background color from the neighboring sections, following the existing light/off-white alternation pattern.

**Layout:** Centered, max-width matching other text sections. A large quote line, then one paragraph.

Quote line (H2 size, can be styled as a pull quote; keep the quotation marks):
```
"Two people ahead of me. I'll leave in 20 minutes."
```

Paragraph below it (regular body text, centered):
```
That's what your clients see. So they stop crowding your bench, stop calling to ask how long, and stop walking out when the shop looks full. You keep the cut. They keep their afternoon.
```

No button in this section.

---

## 6. CTA section — REPLACE COPY

**Location:** Existing "Ready to run a smarter salon?" section. Same layout, same button component.

H2 — **remove** "Ready to run a smarter salon?" **Replace with:**
```
Ready to run a calmer, busier salon?
```

Subhead — **remove** "Create your salon, invite your barbers, and start accepting walk-ins today." **Replace with:**
```
Set up your salon, invite your barbers, and take your first walk-in today.
```

Button (unchanged label and destination):
```
Create a free account
```

---

## 7. PWA banner (maroon block) — REPLACE COPY

**Location:** Existing maroon "Get HairMela on your phone" banner. Same layout and button.

H2 — **remove** "Get HairMela on your phone". **Replace with:**
```
HairMela, right on your phone.
```

Subhead — **remove** "Install HairMela to your device for one-tap access to your queue — no app store, no download size, just a tap." **Replace with:**
```
One tap and your queue is with you all day. No app store, nothing to download.
```

Button (unchanged label):
```
How to install
```

---

## 8. Footer

No changes. Keep PRODUCT / LEGAL / SUPPORT columns, email, and copyright line as they are.

---

## Meta tags (head) — fix while in there

The current meta description contains a typo ("Salons's") and inconsistent capitalization across meta, OG, and Twitter descriptions. Set all three description tags to the same string:

```
HairMela helps salons run their walk-in queue from a phone. Clients see the line live and show up right on time.
```

Keep title tags as they are, or align them to:
```
HairMela — Walk-in Queue for Salons & Barbershops
```
(The title tag may keep its em dash; the no-em-dash rule applies to on-page copy only.)

---

## QA checklist (verify before shipping)

- [ ] No em dashes anywhere in on-page copy (search the rendered page for "—").
- [ ] Hero H1 reads exactly: "Stop losing walk-ins to the wait."
- [ ] "See how it works" button scrolls to the How it works section.
- [ ] Search, filters, and salon cards still work exactly as before, now one section lower.
- [ ] Reassurance line appears under step 3, not as its own section.
- [ ] Proof section appears between How it works and the CTA.
- [ ] CTA headline says "calmer, busier" (not "smarter").
- [ ] All three meta description tags are identical and typo-free.
- [ ] Mobile: hero H1 wraps cleanly and both hero buttons are tappable and stacked if needed.
