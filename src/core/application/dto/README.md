# Data Transfer Objects

Plain types/Zod schemas describing the shape of data crossing the
application boundary (use-case inputs/outputs). Keep these separate from
domain entities so the domain model is free to evolve without breaking
API/Server Action contracts, and vice versa.

Empty on purpose.
