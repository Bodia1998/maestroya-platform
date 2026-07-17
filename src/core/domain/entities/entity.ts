/**
 * Base class for all domain entities.
 *
 * An entity is defined by its identity (`id`), not its attributes — two
 * entities with the same id are the same entity even if their other
 * properties differ. This is the one abstraction every future domain
 * entity (Provider, ServiceRequest, Booking, ...) will extend, so it lives
 * here rather than being duplicated per module.
 *
 * Deliberately framework-agnostic: no Prisma types, no Next.js imports.
 * The domain layer must be importable and testable with zero knowledge of
 * how it's persisted or served.
 */
export abstract class Entity<Props> {
  protected readonly _id: string;
  protected readonly props: Props;

  protected constructor(props: Props, id: string) {
    this._id = id;
    this.props = props;
  }

  get id(): string {
    return this._id;
  }

  public equals(entity?: Entity<Props>): boolean {
    if (entity === null || entity === undefined) return false;
    if (this === entity) return true;
    return this._id === entity._id;
  }
}
