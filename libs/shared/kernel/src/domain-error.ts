/** Domain-meaningful failure kinds; transport mappings (HTTP and others) live outside the domain. */
export type DomainErrorCategory = 'validation' | 'not_found' | 'conflict' | 'forbidden' | 'unauthenticated' | 'rule_violation';

const codePattern = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/**
 * Expected business failure with a stable UPPER_SNAKE code. The message is part of the public
 * contract: keep it static and free of identifiers, personal data, SQL or provider output.
 */
export class DomainError extends Error {
  constructor(readonly code: string, message: string, readonly category: DomainErrorCategory = 'rule_violation') {
    super(message);
    if (!codePattern.test(code)) throw new TypeError('DomainError code must be UPPER_SNAKE_CASE');
    this.name = 'DomainError';
  }
}
