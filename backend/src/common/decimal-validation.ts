import {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';
import { DECIMAL_MAX, DECIMAL_MIN, DECIMAL_SCALE, FULL_ACCESS_DECIMAL, parseDecimal } from './decimal';

/**
 * FC-DATA-001 — the DTO half of the decimal boundary.
 *
 * A quantity or money value arrives as a plain decimal **string** (`'0.1'`) and
 * leaves as one. The previous contract demanded a JSON number, which is exactly
 * what made precision unrepresentable: `0.1 + 0.2` in the browser had already
 * become `0.30000000000000004` before the request was ever sent.
 *
 * A JSON number is still tolerated, but only when it is integral or round-trips
 * exactly, so existing clients keep working while no value is ever silently
 * rounded on the way in.
 */
@ValidatorConstraint({ name: 'isDecimalString', async: false })
export class IsDecimalStringConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (value === undefined || value === null || value === '') return true;

    try {
      parseDecimal(value, args.property, { scale: DECIMAL_SCALE });
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    const value = args.value;
    if (typeof value === 'number' && !Number.isInteger(value)) {
      return `${args.property} must be a decimal string; the number ${value} has already lost precision. Send "${value}" instead.`;
    }
    if (typeof value === 'string' && !FULL_ACCESS_DECIMAL.test(value.trim())) {
      return `${args.property} must be a plain decimal string with at most ${DECIMAL_SCALE} decimal places, between ${DECIMAL_MIN} and ${DECIMAL_MAX}`;
    }
    return `${args.property} must be a decimal value between ${DECIMAL_MIN} and ${DECIMAL_MAX} with at most ${DECIMAL_SCALE} decimal places`;
  }
}

/**
 * Accepts a decimal as a string (preferred) or as a lossless JSON number.
 * The value is NOT converted here; `parseDecimal` does that at the write path
 * so one rule governs every entry point.
 */
export const IsDecimalString = (validationOptions?: ValidationOptions) =>
  (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: { message: validationOptions?.message, ...validationOptions },
      constraints: [],
      validator: IsDecimalStringConstraint,
    });
  };
