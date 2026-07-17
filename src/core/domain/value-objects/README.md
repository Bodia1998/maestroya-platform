# Value Objects

Immutable objects defined by their attributes, not an identity (unlike
entities). Examples for future modules: `Money`, `EmailAddress`,
`ServiceArea`, `Rating`.

Empty on purpose — no marketplace domain has been modeled yet. When adding
one: no framework imports, validate invariants in the constructor, expose
an `equals()` method.
