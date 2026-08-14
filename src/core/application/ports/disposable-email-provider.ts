/**
 * Module 65 — Trust & Integrity System: requirement #7 — disposable/
 * temporary email detection provider abstraction.
 */
export interface DisposableEmailProvider {
  readonly name: string;
  isDisposable(email: string): Promise<boolean>;
}
