# Use Cases

One file per use case (e.g. `create-service-request.use-case.ts`),
each a single class or function with one public method (`execute()`).
Use cases orchestrate domain entities and repository interfaces; they
contain application logic, not business rules (those belong in the
domain layer) and not framework code (that belongs in infrastructure
or in the Route Handler / Server Action that calls the use case).

Empty on purpose — populate alongside the first real feature.
