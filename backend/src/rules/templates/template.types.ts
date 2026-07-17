export const TEMPLATE_METAMODEL_VERSION = 'template/1' as const;

export type TemplateParameterType = 'string' | 'number' | 'boolean' | 'select';

export interface TemplateParameter {
  parameterId: string;
  label: string;
  type: TemplateParameterType;
  required: boolean;
  default?: string | number | boolean;
  help?: string;
  options?: string[]; // for select type
}

/** One definition produced when the template is instantiated. May contain {{parameterId}} or {{parameterId|slug}} slots. */
export interface TemplateGeneratedDefinition {
  templateDefinitionId: string;
  definitionType: string;
  nameTemplate: string;
  descriptionTemplate?: string;
  /** Recursive slot substitution is applied to all string values in the body. */
  bodyTemplate: Record<string, unknown>;
}

export interface TemplateDefinition {
  formatVersion: '1';
  metamodelVersion: typeof TEMPLATE_METAMODEL_VERSION;
  definitionId: string;
  definitionType: 'template';
  name: string;
  description?: string;
  /** Metamodel version of the definitions this template generates, e.g. 'resolution/1'. */
  targetMetamodelVersion: string;
  parameters: TemplateParameter[];
  generates: TemplateGeneratedDefinition[];
}

export type TemplateParameterValues = Record<string, string | number | boolean>;

export interface TemplateDiagnostic {
  code: string;
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface TemplateInstantiationResult {
  valid: boolean;
  templateId: string;
  parameterValues: TemplateParameterValues;
  definitions: Array<{
    definitionId: string;
    definitionType: string;
    name: string;
    body: Record<string, unknown>;
  }>;
  diagnostics: TemplateDiagnostic[];
}
