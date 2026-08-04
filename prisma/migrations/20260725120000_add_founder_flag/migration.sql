-- Founder is an honour carried by Bill and Lois, not a layout anchor.
--
-- The descent plate lets the viewer choose who sits in the centre. Without an
-- explicit flag, "founder" would have to mean "whoever the tree currently descends
-- from" — and that silently promotes a new couple every time a generation is added
-- above, which is exactly what happens next as the ancestry gets filled in.
ALTER TABLE "FamilyMember"
    ADD COLUMN "isFounder" BOOLEAN NOT NULL DEFAULT false;
