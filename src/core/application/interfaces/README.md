# Application-Layer Interfaces

Ports needed by use cases that aren't repositories — e.g. a
`PaymentGateway` interface implemented by a Stripe adapter, a
`FileStorage` interface implemented by a Cloudinary adapter, an
`EmailSender` interface. Keeping these as interfaces here (implemented in
infrastructure/) is what lets use cases be unit-tested without hitting
Stripe/Cloudinary/a real inbox.

Empty on purpose.
