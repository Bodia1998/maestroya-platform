# Repository Interfaces (Ports)

Interfaces only — e.g. `interface ProviderRepository { findById(id: string): Promise<Provider | null>; ... }`.
Concrete implementations (Prisma-backed) live in
`src/core/infrastructure/database/prisma/repositories/` and are injected
into use cases, never imported by the domain/application layers directly.

Empty on purpose — no repositories exist until there are entities to
persist.
