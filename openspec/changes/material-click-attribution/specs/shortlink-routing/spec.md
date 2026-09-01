## ADDED Requirements

### Requirement: Short Link Material Association

A short link SHALL optionally carry a `materialId` referencing the material that produced it. When the referenced material is deleted, the short link's `materialId` SHALL be set to null (the short link and its click history are retained). Short link creation SHALL accept an optional `materialId`; clicks continue to be recorded in `ClickLog` as before, and material attribution is derived by joining `ClickLog → ShortLink.materialId`.

#### Scenario: Create short link with material id

- **WHEN** a short link is created with a `materialId`
- **THEN** the short link stores the material association and clicks on it are attributable to that material

#### Scenario: Material deletion nulls the association

- **WHEN** a material referenced by short links is deleted
- **THEN** those short links' `materialId` becomes null and the short links (with click history) are retained

#### Scenario: Short link without material id still works

- **WHEN** a short link is created without a `materialId` (manual short link)
- **THEN** it behaves exactly as before, with no material attribution
