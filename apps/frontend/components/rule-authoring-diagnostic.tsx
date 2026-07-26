'use client';

import Link from 'next/link';
import type { AuthoringDiagnostic } from '@/lib/rule-authoring';
import type { RuleDefinitionResource } from '@/lib/rule-sets';

const TRAIT_DIAGNOSTIC_MESSAGES: Record<string, string> = {
  RULE_TRAIT_FIELD_DEFAULT_OUT_OF_RANGE: 'numeric default must fall within its declared bounds.',
  RULE_TRAIT_GRANT_KEY_REQUIRED: 'trait grant must specify a path name.',
  RULE_TRAIT_MIGRATION_PLACEMENT_MISSING: 'trait grant must specify a path name before migration.',
  RULE_TRAIT_MODIFIER_AMOUNT_REQUIRED: 'modifier must specify a value.',
  RULE_TRAIT_MODIFIER_PATH_REQUIRED: 'modifier must specify a target field.',
};

export function RuleAuthoringDiagnosticItem({
  definitions,
  diagnostic,
  ruleSetId,
}: {
  definitions: RuleDefinitionResource[];
  diagnostic: AuthoringDiagnostic;
  ruleSetId: number;
}) {
  const definition = definitions.find((candidate) =>
    candidate.externalId === diagnostic.definitionExternalId)
    ?? definitions.find((candidate) => candidate.name === diagnostic.definitionName);
  const definitionName = definition?.name ?? diagnostic.definitionName;
  const conciseMessage = TRAIT_DIAGNOSTIC_MESSAGES[diagnostic.code];

  return (
    <li>
      {definition ? (
        <Link
          className="link link-hover"
          href={`/rule-sets/${ruleSetId}?definition=${definition.id}#definition-editor`}
        >
          {definition.name}
        </Link>
      ) : definitionName ? (
        <strong>{definitionName}</strong>
      ) : null}
      {definitionName
        ? conciseMessage
          ? ` ${conciseMessage}`
          : `: ${diagnostic.message}`
        : diagnostic.message}
    </li>
  );
}
