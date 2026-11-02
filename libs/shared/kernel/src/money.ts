import { DomainError } from './domain-error';

/** ISO 4217 code with its minor-unit exponent. */
export interface Currency {
  readonly code: string;
  readonly minorUnits: number;
}

export function currency(code: string, minorUnits: number): Currency {
  if (!/^[A-Z]{3}$/.test(code) || !Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 4) throw new TypeError('Invalid currency definition');
  return Object.freeze({ code, minorUnits });
}

/** KSA-first baseline currency (ADR-019). */
export const SAR = currency('SAR', 2);

/**
 * Exact amount in integer minor units. There is deliberately no floating-point input and no
 * rounding: rounding, tax and cash-rounding policies belong to Pricing/Billing (decision G04).
 */
export class Money {
  private constructor(readonly minor: bigint, readonly currency: Currency) {
    Object.freeze(this);
  }

  static ofMinor(minor: bigint, currency: Currency): Money {
    return new Money(minor, currency);
  }

  static zero(currency: Currency): Money {
    return new Money(0n, currency);
  }

  /** Parses a plain decimal string such as "12.50"; more fractional digits than the currency allows are rejected. */
  static parse(amount: string, currency: Currency): Money {
    const match = /^(-?)(0|[1-9]\d{0,17})(?:\.(\d+))?$/.exec(amount);
    const fraction = match?.[3] ?? '';
    if (!match || fraction.length > currency.minorUnits) throw new DomainError('INVALID_MONEY_AMOUNT', 'Amount is not a valid decimal for its currency.', 'validation');
    const minor = BigInt((match[2] ?? '0') + fraction.padEnd(currency.minorUnits, '0'));
    return new Money(match[1] ? -minor : minor, currency);
  }

  add(other: Money): Money {
    return new Money(this.minor + this.sameCurrency(other).minor, this.currency);
  }

  subtract(other: Money): Money {
    return new Money(this.minor - this.sameCurrency(other).minor, this.currency);
  }

  /** Multiplies by an integer quantity; fractional factors need an explicit rounding policy owned elsewhere. */
  times(quantity: number | bigint): Money {
    if (typeof quantity === 'number' && !Number.isSafeInteger(quantity)) throw new DomainError('INVALID_MONEY_QUANTITY', 'Quantity must be an integer.', 'validation');
    return new Money(this.minor * BigInt(quantity), this.currency);
  }

  negate(): Money {
    return new Money(-this.minor, this.currency);
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  compare(other: Money): -1 | 0 | 1 {
    const difference = this.minor - this.sameCurrency(other).minor;
    return difference === 0n ? 0 : difference < 0n ? -1 : 1;
  }

  equals(other: Money): boolean {
    return this.currency.code === other.currency.code && this.currency.minorUnits === other.currency.minorUnits && this.minor === other.minor;
  }

  /** Canonical decimal string, e.g. "-0.05"; suitable for contracts and snapshots. */
  toDecimal(): string {
    const digits = (this.minor < 0n ? -this.minor : this.minor).toString().padStart(this.currency.minorUnits + 1, '0');
    const split = digits.length - this.currency.minorUnits;
    const body = this.currency.minorUnits ? digits.slice(0, split) + '.' + digits.slice(split) : digits;
    return (this.minor < 0n ? '-' : '') + body;
  }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.toDecimal(), currency: this.currency.code };
  }

  private sameCurrency(other: Money): Money {
    if (other.currency.code !== this.currency.code || other.currency.minorUnits !== this.currency.minorUnits) throw new DomainError('CURRENCY_MISMATCH', 'Amounts have different currencies.', 'validation');
    return other;
  }
}
