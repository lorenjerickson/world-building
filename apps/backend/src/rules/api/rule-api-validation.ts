import {
  BadRequestException,
  Injectable,
  PipeTransform,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';

function validationDetails(errors: ValidationError[]): Array<{ field: string; constraints: string[] }> {
  return errors.map((error) => ({
    field: error.property,
    constraints: Object.keys(error.constraints ?? {}),
  }));
}

export const ruleApiValidationPipe = new ValidationPipe({
  exceptionFactory: (errors) => new BadRequestException({
    code: 'RULE_REQUEST_INVALID',
    details: validationDetails(errors),
    message: 'The rule-set request is invalid.',
    retryable: false,
  }),
});

@Injectable()
export class RuleApiIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^[1-9]\d*$/.test(value)) {
      throw new BadRequestException({
        code: 'RULE_ID_INVALID',
        message: 'Rule-set resource IDs must be positive integers.',
        retryable: false,
      });
    }
    return Number(value);
  }
}
