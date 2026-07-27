import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { act, useState } from 'react';
import {
  publishRuleSet,
  updateRuleDefinition,
  type RuleDefinitionResource,
  type RuleSetResource,
} from '../lib/rule-sets';
import {
  buildGrantsBody,
  grantsDraftFromBody,
  GuidedTraitGrantsEditor,
  prerequisitesDraftFromBody,
  type GrantDraft,
} from './guided-trait-grants-editor';

const now = '2026-07-25T00:00:00.000Z';

function definition(
  externalId: string,
  name: string,
  grants: Array<Record<string, unknown>>,
): RuleDefinitionResource {
  return {
    id: 1,
    externalId,
    ruleSetId: 1,
    moduleId: 1,
    definitionType: 'trait',
    name,
    schemaVersion: 1,
    visibility: 'exported',
    body: { metamodelVersion: 'trait/2', grants },
    tags: [],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
}

const traitDefinitions = [
  definition('trait:walk', 'Walk', [
    { dataType: 'number', key: 'rate', label: 'Rate', required: true, min: 0, unit: 'ft/turn' },
    { dataType: 'text', key: 'label', label: 'Label' },
    { dataType: 'boolean', key: 'enabled', label: 'Enabled', default: true },
    { dataType: 'enum', key: 'mode', label: 'Mode', allowedValues: ['fast', 'slow'] },
  ]),
  definition('trait:fly', 'Fly', [
    { dataType: 'number', key: 'rate', label: 'Rate', required: true, min: 0 },
  ]),
  definition('trait:speed', 'Speed', [
    { dataType: 'trait', ref: 'trait:walk', at: 'this.walk' },
  ]),
  definition('trait:creature', 'Creature', [
    { dataType: 'trait', ref: 'trait:speed', at: 'this.speed' },
  ]),
  definition('trait:die', 'Die', [
    { dataType: 'number', key: 'sides', label: 'Sides', required: true, min: 1 },
  ]),
  definition('trait:dice-roll', 'Dice Roll', [
    { dataType: 'trait-collection', key: 'dice', label: 'Dice', acceptedTraits: ['trait:die'] },
  ]),
];

function grant(overrides: Partial<GrantDraft>): GrantDraft {
  return {
    _id: 'draft-grant',
    key: '',
    label: '',
    dataType: 'modifier',
    required: true,
    min: '',
    max: '',
    defaultNum: '',
    unit: '',
    defaultStr: '',
    allowedValues: '',
    ref: '',
    traitPlacement: 'named',
    traitCount: '1',
    traitCollection: '',
    traitParentPath: '',
    modifierOperation: 'increases',
    modifierFieldSegments: [],
    modifierAmount: '',
    modifierAmountUnit: '',
    modifierPriority: '0',
    modifierConditionEnabled: false,
    modifierConditionOperator: 'equals',
    modifierConditionValue: '',
    modifierConditionUnit: '',
    modifierMountSelectorMode: 'all',
    modifierMountOrdinal: '1',
    modifierMountSelectors: [],
    structuralTargetSegments: [],
    structuralPriority: '0',
    structuralMountSelectorMode: 'all',
    structuralMountOrdinal: '1',
    structuralMountSelectors: [],
    collectionCapacity: '',
    acceptedTraits: [],
    acceptedTraitsMode: 'any',
    ...overrides,
  };
}

async function renderEditor(
  initialGrants: GrantDraft[],
  prerequisiteIds = ['trait:creature'],
  onPublish?: (grants: GrantDraft[]) => Promise<string>,
  options: {
    prerequisiteMode?: 'any' | 'all';
    traitDefinitions?: RuleDefinitionResource[];
  } = {},
) {
  const window = new Window({ url: 'http://localhost/' });
  const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
  const globals: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    Node: window.Node,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    InputEvent: window.InputEvent,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
  };
  for (const [key, value] of Object.entries(globals)) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

  const container = window.document.createElement('div') as unknown as HTMLDivElement;
  window.document.body.append(container as unknown as import('happy-dom').HTMLElement);
  const { createRoot } = await import('react-dom/client');
  let root: import('react-dom/client').Root;

  function Harness() {
    const [grants, setGrants] = useState(initialGrants);
    const [publishStatus, setPublishStatus] = useState('');
    return (
      <>
        <GuidedTraitGrantsEditor
          traitName="Winged Boots"
          grants={grants}
          prerequisites={{ mode: options.prerequisiteMode ?? 'all', ids: prerequisiteIds }}
          traitDefinitions={options.traitDefinitions ?? traitDefinitions}
          onChange={setGrants}
        />
        {onPublish && (
          <>
            <button type="button" onClick={async () => {
              setPublishStatus(await onPublish(grants));
            }}>Save and publish</button>
            <output aria-label="Publish status">{publishStatus}</output>
          </>
        )}
      </>
    );
  }

  await act(async () => {
    root = createRoot(container);
    root.render(<Harness />);
  });

  return {
    container,
    window,
    async cleanup() {
      await act(async () => root.unmount());
      window.close();
      for (const [key, descriptor] of previousGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

function optionButton(
  container: HTMLDivElement,
  label: string,
): HTMLButtonElement {
  const option = [...container.querySelectorAll<HTMLButtonElement>('button[role="option"]')]
    .find((candidate) => candidate.querySelector('.combo-option-label')?.textContent?.trim() === label);
  assert.ok(option, `Expected option "${label}"`);
  return option;
}

async function chooseHighlightedOption(
  rendered: Awaited<ReturnType<typeof renderEditor>>,
) {
  const search = rendered.container.querySelector<HTMLInputElement>(
    'input[aria-label="Search complete modifier paths"]',
  );
  assert.ok(search);
  await act(async () => {
    search.dispatchEvent(
      new rendered.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }) as unknown as Event,
    );
  });
  await act(async () => {
    search.dispatchEvent(
      new rendered.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event,
    );
  });
}

test('new trait grants focus the reference and tab confirms the best matching trait', async () => {
  const rendered = await renderEditor([]);
  try {
    const addTrait = [...rendered.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '+ trait grant');
    assert.ok(addTrait);
    await act(async () => {
      addTrait.click();
      await Promise.resolve();
    });

    const search = rendered.container.querySelector<HTMLInputElement>(
      'input[aria-label="Search ref options"]',
    );
    assert.ok(search);
    assert.equal(rendered.window.document.activeElement, search);
    assert.equal(rendered.container.querySelector('input[aria-label="Trait Count"]'), null);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(rendered.window.HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(search, 'fl');
      search.dispatchEvent(new rendered.window.InputEvent('input', { bubbles: true }) as unknown as Event);
    });
    await act(async () => {
      search.dispatchEvent(
        new rendered.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }) as unknown as Event,
      );
    });

    assert.ok(rendered.container.querySelector('button[aria-label="Ref: Fly"]'));
    const keyInput = rendered.container.querySelector<HTMLInputElement>('input[aria-label="Key"]');
    assert.ok(keyInput);
    assert.equal(rendered.window.document.activeElement, keyInput);
  } finally {
    await rendered.cleanup();
  }
});

test('collection capacity and accepted traits support keyboard chaining', async () => {
  const rendered = await renderEditor([]);
  try {
    const addCollection = [...rendered.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '+ trait collection');
    assert.ok(addCollection);
    await act(async () => {
      addCollection.click();
      await Promise.resolve();
    });

    const key = rendered.container.querySelector<HTMLInputElement>('input[aria-label="Key"]');
    assert.ok(key);
    assert.equal(rendered.window.document.activeElement, key);
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(rendered.window.HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(key, 'belt');
      key.dispatchEvent(new rendered.window.InputEvent('input', { bubbles: true }) as unknown as Event);
      key.dispatchEvent(
        new rendered.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }) as unknown as Event,
      );
    });

    const capacity = rendered.container.querySelector<HTMLInputElement>(
      'input[aria-label="Collection Capacity"]',
    );
    assert.ok(capacity);
    assert.equal(rendered.window.document.activeElement, capacity);
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(rendered.window.HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(capacity, '4');
      capacity.dispatchEvent(new rendered.window.InputEvent('input', { bubbles: true }) as unknown as Event);
      capacity.dispatchEvent(
        new rendered.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event,
      );
    });

    const mode = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Accepted base trait matching mode"]',
    );
    assert.ok(mode);
    assert.equal(rendered.window.document.activeElement, mode);
    await act(async () => {
      mode.dispatchEvent(
        new rendered.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }) as unknown as Event,
      );
    });
    assert.equal(mode.textContent, 'all of:');
    assert.equal(rendered.window.document.activeElement, mode);

    await act(async () => {
      mode.dispatchEvent(
        new rendered.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event,
      );
    });
    const search = rendered.container.querySelector<HTMLInputElement>(
      'input[aria-label="Search accepted trait options"]',
    );
    assert.ok(search);
    assert.equal(rendered.window.document.activeElement, search);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(rendered.window.HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(search, 'die');
      search.dispatchEvent(new rendered.window.InputEvent('input', { bubbles: true }) as unknown as Event);
    });
    await act(async () => {
      search.dispatchEvent(
        new rendered.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event,
      );
      await Promise.resolve();
    });

    const addBaseTrait = [...rendered.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '+ base trait');
    assert.ok(addBaseTrait);
    assert.equal(rendered.window.document.activeElement, addBaseTrait);
    await act(async () => {
      addBaseTrait.dispatchEvent(
        new rendered.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }) as unknown as Event,
      );
      await Promise.resolve();
    });
    const nextSearch = rendered.container.querySelector<HTMLInputElement>(
      'input[aria-label="Search accepted trait options"]',
    );
    assert.ok(nextSearch);
    assert.equal(rendered.window.document.activeElement, nextSearch);
  } finally {
    await rendered.cleanup();
  }
});

test('collection capacity serializes without slot-specific vocabulary', () => {
  const body = buildGrantsBody([
    grant({
      dataType: 'trait-collection',
      key: 'quickAccess',
      collectionCapacity: '4',
      acceptedTraits: ['trait:die'],
    }),
  ]);

  assert.deepEqual(body.grants, [{
    dataType: 'trait-collection',
    key: 'quickAccess',
    required: true,
    capacity: 4,
    acceptedTraits: ['trait:die'],
  }]);
});

test('removed slot grants remain available through raw JSON instead of malformed guided controls', () => {
  for (const dataType of ['slot', 'slot-affinity']) {
    assert.equal(grantsDraftFromBody({
      metamodelVersion: 'trait/2',
      grants: [{ dataType }],
    }), null);
  }
});

test('new prerequisite drafts default to requiring every selected trait', () => {
  assert.deepEqual(prerequisitesDraftFromBody({
    metamodelVersion: 'trait/2',
    grants: [],
  }), {
    mode: 'all',
    ids: [],
  });
});

test('modifier paths expose root fields guaranteed by all prerequisites', async () => {
  const definitions = [
    definition('trait:subject-a', 'Subject A', [
      { dataType: 'number', key: 'range', label: 'Range', unit: 'ft' },
    ]),
    definition('trait:subject-b', 'Subject B', [
      { dataType: 'modifier', operation: 'sets', field: 'self.range', amount: 5 },
    ]),
  ];
  const rendered = await renderEditor(
    [grant({ modifierOperation: 'increases' })],
    ['trait:subject-a', 'trait:subject-b'],
    undefined,
    { prerequisiteMode: 'all', traitDefinitions: definitions },
  );
  try {
    const pathButton = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Modifier path: not selected"]',
    );
    assert.ok(pathButton);
    await act(async () => pathButton.click());
    await act(async () => optionButton(rendered.container, 'self').click());

    const range = optionButton(rendered.container, 'Range');
    assert.equal(range.querySelector('.combo-option-hint')?.textContent, 'number');
    await act(async () => range.click());
    assert.ok(rendered.container.querySelector(
      'button[aria-label="Modifier path: self › range"]',
    ));
  } finally {
    await rendered.cleanup();
  }
});

test('modifier paths explain empty intersections for alternative prerequisites', async () => {
  const definitions = [
    definition('trait:subject-a', 'Subject A', [
      { dataType: 'number', key: 'range', label: 'Range', unit: 'ft' },
    ]),
    definition('trait:subject-b', 'Subject B', []),
  ];
  const rendered = await renderEditor(
    [grant({ modifierOperation: 'increases' })],
    ['trait:subject-a', 'trait:subject-b'],
    undefined,
    { prerequisiteMode: 'any', traitDefinitions: definitions },
  );
  try {
    const pathButton = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Modifier path: not selected"]',
    );
    assert.ok(pathButton);
    await act(async () => pathButton.click());
    await act(async () => optionButton(rendered.container, 'self').click());

    assert.match(
      rendered.container.querySelector('[role="status"]')?.textContent ?? '',
      /“Any of” prerequisites expose only fields shared by every alternative/i,
    );
  } finally {
    await rendered.cleanup();
  }
});

test('modifier paths support accessible full-path search and keyboard selection', async () => {
  const rendered = await renderEditor([grant({})]);
  try {
    const pathButton = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Modifier path: not selected"]',
    );
    assert.ok(pathButton);
    await act(async () => pathButton.click());

    const search = rendered.container.querySelector<HTMLInputElement>(
      'input[aria-label="Search complete modifier paths"]',
    );
    assert.ok(search);
    assert.equal(search.getAttribute('role'), 'combobox');
    assert.ok(search.getAttribute('aria-controls'));

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(rendered.window.HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(search, 'walk rate');
      search.dispatchEvent(new rendered.window.InputEvent('input', { bubbles: true }) as unknown as Event);
    });

    const options = rendered.container.querySelectorAll('[role="option"]');
    assert.ok(options.length >= 1);
    assert.match(options[0]?.textContent ?? '', /Self.*Speed.*Walk.*Rate/i);

    await act(async () => {
      search.dispatchEvent(
        new rendered.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }) as unknown as Event,
      );
    });
    assert.ok(search.getAttribute('aria-activedescendant'));

    await act(async () => {
      search.dispatchEvent(
        new rendered.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event,
      );
    });

    assert.ok(rendered.container.querySelector(
      'button[aria-label="Modifier path: self › speed › walk › rate"]',
    ));
    const amountButton = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Modifier Amount: not set"]',
    );
    if (amountButton) {
      await act(async () => amountButton.click());
    }
    const amount = rendered.container.querySelector<HTMLInputElement>('input[aria-label="Modifier Amount"]');
    assert.ok(amount);
    assert.equal(amount.type, 'number');
  } finally {
    await rendered.cleanup();
  }

});

test('modifier paths support arbitrary-depth segment traversal with pointer and keyboard', async () => {
  const pointer = await renderEditor([grant({})]);
  try {
    const pathButton = pointer.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Modifier path: not selected"]',
    );
    assert.ok(pathButton);
    await act(async () => pathButton.click());

    for (const label of ['self', 'Speed', 'Walk', 'Rate']) {
      await act(async () => optionButton(pointer.container, label).click());
    }

    assert.ok(pointer.container.querySelector(
      'button[aria-label="Modifier path: self › speed › walk › rate"]',
    ));
  } finally {
    await pointer.cleanup();
  }

  const keyboard = await renderEditor([grant({})]);
  try {
    const pathButton = keyboard.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Modifier path: not selected"]',
    );
    assert.ok(pathButton);
    await act(async () => pathButton.click());

    for (let depth = 0; depth < 4; depth += 1) {
      await chooseHighlightedOption(keyboard);
    }

    assert.ok(keyboard.container.querySelector(
      'button[aria-label="Modifier path: self › speed › walk › rate"]',
    ));
  } finally {
    await keyboard.cleanup();
  }
});

test('modifier path dismissal restores focus after Escape and outside pointer input', async () => {
  for (const dismissal of ['escape', 'outside'] as const) {
    const rendered = await renderEditor([grant({})]);
    try {
      const pathButton = rendered.container.querySelector<HTMLButtonElement>(
        'button[aria-label="Modifier path: not selected"]',
      );
      assert.ok(pathButton);
      await act(async () => pathButton.click());

      const search = rendered.container.querySelector<HTMLInputElement>(
        'input[aria-label="Search complete modifier paths"]',
      );
      assert.ok(search);
      assert.equal(rendered.window.document.activeElement, search);

      await act(async () => {
        if (dismissal === 'escape') {
          search.dispatchEvent(
            new rendered.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event,
          );
        } else {
          rendered.window.document.body.dispatchEvent(
            new rendered.window.MouseEvent('mousedown', { bubbles: true }),
          );
        }
        await Promise.resolve();
      });

      assert.equal(rendered.container.querySelector('[role="dialog"]'), null);
      assert.equal(rendered.window.document.activeElement, pathButton);
    } finally {
      await rendered.cleanup();
    }
  }
});

test('effective-shape trees and diagnostics expose named assistive-technology state', async () => {
  const trees = await renderEditor([grant({})]);
  try {
    const beforeTree = trees.container.querySelector('[role="tree"][aria-label="Prerequisite trait structure"]');
    const afterTree = trees.container.querySelector('[role="tree"][aria-label="Draft effective trait structure"]');
    assert.ok(beforeTree);
    assert.ok(afterTree);
    assert.ok(beforeTree.querySelector('[role="treeitem"][aria-expanded="true"]'));
    assert.ok(beforeTree.querySelector('[role="group"]'));
    assert.equal(beforeTree.querySelector('[role="treeitem"]')?.getAttribute('aria-selected'), 'false');
  } finally {
    await trees.cleanup();
  }

  const diagnostics = await renderEditor([
    grant({ _id: 'first', dataType: 'number', key: 'duplicate' }),
    grant({ _id: 'second', dataType: 'text', key: 'duplicate' }),
  ]);
  try {
    const status = diagnostics.container.querySelector<HTMLElement>(
      '.guided-rule-diagnostics[role="status"][aria-live="polite"]',
    );
    assert.ok(status);
    const labelledBy = status.getAttribute('aria-labelledby');
    assert.ok(labelledBy);
    assert.equal(diagnostics.window.document.getElementById(labelledBy)?.textContent, 'Trait structure needs attention');
    assert.match(status.textContent ?? '', /duplicate/i);
  } finally {
    await diagnostics.cleanup();
  }
});

test('effective-shape preview renders a before/after nested-addition diff', async () => {
  const rendered = await renderEditor([
    grant({
      dataType: 'trait',
      ref: 'trait:fly',
      key: 'fly',
      traitPlacement: 'nested',
      traitParentPath: 'self.speed',
    }),
  ]);
  try {
    assert.match(rendered.container.textContent ?? '', /Before\s*Prerequisite structure/);
    assert.match(rendered.container.textContent ?? '', /After\s*With this draft/);

    const changes = rendered.container.querySelectorAll('[aria-label="Effective shape changes"] > li');
    assert.equal(changes.length, 2);
    assert.match(changes[0]?.textContent ?? '', /added.*self\.speed\.fly/i);
    assert.match(changes[1]?.textContent ?? '', /added.*self\.speed\.fly\.rate/i);
  } finally {
    await rendered.cleanup();
  }

  const preview = await renderEditor([grant({
    dataType: 'suppression',
    structuralTargetSegments: ['self', 'speed', 'walk'],
    structuralPriority: '10',
  })]);
  try {
    const changes = [...preview.container.querySelectorAll('[aria-label="Effective shape changes"] > li')]
      .map((change) => change.textContent ?? '');
    assert.ok(changes.some((change) => /removed.*self\.speed\.walk/i.test(change)));
    assert.ok(changes.some((change) => /removed.*self\.speed\.walk\.rate/i.test(change)));
  } finally {
    await preview.cleanup();
  }
});

test('structural controls offer exact branch targets and serialize suppression and replacement', async () => {
  const body = buildGrantsBody([
    grant({
      _id: 'grounded',
      dataType: 'suppression',
      structuralTargetSegments: ['self', 'speed', 'walk'],
      structuralPriority: '10',
    }),
    grant({
      _id: 'adapted',
      dataType: 'replacement',
      structuralTargetSegments: ['this', 'speed', 'walk'],
      structuralPriority: '20',
      ref: 'trait:fly',
    }),
    grant({
      _id: 'trimmed',
      dataType: 'suppression',
      structuralTargetSegments: ['self', 'dice[]'],
      structuralMountSelectorMode: 'ordinal',
      structuralMountOrdinal: '2',
      structuralPriority: '30',
    }),
  ], { mode: 'all', ids: ['trait:creature'] }, traitDefinitions);
  assert.deepEqual(body.grants, [
    { dataType: 'suppression', target: 'self.speed.walk', priority: 10 },
    { dataType: 'replacement', target: 'this.speed.walk', priority: 20, ref: 'trait:fly' },
    {
      dataType: 'suppression',
      target: 'self.dice[]',
      mountSelector: { mode: 'ordinal', ordinal: 2 },
      priority: 30,
    },
  ]);

  const rendered = await renderEditor([grant({ dataType: 'suppression' })]);
  try {
    const target = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Structural Target: not selected"]',
    );
    assert.ok(target);
    await act(async () => target.click());
    const options = [...rendered.container.querySelectorAll('[role="option"]')]
      .map((option) => option.textContent?.trim() ?? '');
    assert.ok(options.some((option) => option.includes('self.speed.walk')));
    assert.ok(options.some((option) => option.includes('this.speed.walk')));
    assert.equal(options.some((option) => option.includes('self.speed.walk.rate')), false);
  } finally {
    await rendered.cleanup();
  }

  const repeated = await renderEditor([grant({
    dataType: 'suppression',
    structuralTargetSegments: ['self', 'dice[]'],
    structuralMountSelectorMode: 'ordinal',
    structuralMountOrdinal: '2',
  })], ['trait:dice-roll']);
  try {
    assert.match(repeated.container.textContent ?? '', /entry number\s*#\s*2/i);
  } finally {
    await repeated.cleanup();
  }
});

test('modifier value controls match terminal types and arithmetic hides incompatible fields', async () => {
  const cases = [
    {
      path: ['self', 'speed', 'walk', 'rate'],
      operation: 'increases',
      expectedButton: 'Modifier Amount: not set',
      expectedInputType: 'number',
    },
    {
      path: ['self', 'speed', 'walk', 'label'],
      operation: 'sets',
      expectedButton: 'Modifier Amount: not set',
      expectedInputType: 'text',
    },
    {
      path: ['self', 'speed', 'walk', 'enabled'],
      operation: 'sets',
      expectedButton: 'Modifier Amount: not selected',
      expectedOptions: ['true', 'false'],
    },
    {
      path: ['self', 'speed', 'walk', 'mode'],
      operation: 'sets',
      expectedButton: 'Modifier Amount: not selected',
      expectedOptions: ['fast', 'slow'],
    },
  ];

  for (const scenario of cases) {
    const rendered = await renderEditor([grant({
      modifierFieldSegments: scenario.path,
      modifierOperation: scenario.operation as GrantDraft['modifierOperation'],
    })]);
    try {
      const amountButton = rendered.container.querySelector<HTMLButtonElement>(
        `button[aria-label="${scenario.expectedButton}"]`,
      );
      assert.ok(amountButton, scenario.path.join('.'));
      await act(async () => amountButton.click());

      if (scenario.expectedInputType) {
        const input = rendered.container.querySelector<HTMLInputElement>('input[aria-label="Modifier Amount"]');
        assert.ok(input);
        assert.equal(input.type, scenario.expectedInputType);
      } else {
        const options = [...rendered.container.querySelectorAll('[role="option"]')]
          .map((option) => option.textContent?.trim());
        assert.deepEqual(options, scenario.expectedOptions);
      }
    } finally {
      await rendered.cleanup();
    }
  }

  const filtered = await renderEditor([grant({ modifierOperation: 'increases' })]);
  try {
    const pathButton = filtered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Modifier path: not selected"]',
    );
    assert.ok(pathButton);
    await act(async () => pathButton.click());
    const search = filtered.container.querySelector<HTMLInputElement>(
      'input[aria-label="Search complete modifier paths"]',
    );
    assert.ok(search);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(filtered.window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(search, 'enabled');
      search.dispatchEvent(new filtered.window.InputEvent('input', { bubbles: true }) as unknown as Event);
    });
    assert.match(
      filtered.container.querySelector('[role="status"]')?.textContent ?? '',
      /No complete modifier path matches/i,
    );
  } finally {
    await filtered.cleanup();
  }
});

test('numeric unit controls serialize canonical authored and modifier amounts', async () => {
  const body = buildGrantsBody([
    grant({
      _id: 'rate',
      dataType: 'number',
      key: 'rate',
      unit: 'ft/turn',
      defaultNum: '20',
    }),
    grant({
      _id: 'boost',
      modifierFieldSegments: ['self', 'speed', 'walk', 'rate'],
      modifierOperation: 'at-least',
      modifierAmount: '3.048',
      modifierAmountUnit: 'm/turn',
      modifierPriority: '7',
      modifierConditionEnabled: true,
      modifierConditionOperator: 'lte',
      modifierConditionValue: '30',
      modifierConditionUnit: 'ft/turn',
    }),
  ], { mode: 'all', ids: ['trait:creature'] }, traitDefinitions);
  assert.equal(body.grants[0]?.unit, 'ft/turn');
  assert.deepEqual(body.grants[1]?.amount, { value: 3.048, unit: 'm/turn' });
  assert.equal(body.grants[1]?.operation, 'at-least');
  assert.equal(body.grants[1]?.priority, 7);
  assert.deepEqual(body.grants[1]?.when, {
    operator: 'lte',
    value: { value: 30, unit: 'ft/turn' },
  });

  const rendered = await renderEditor([grant({
    modifierFieldSegments: ['self', 'speed', 'walk', 'rate'],
    modifierAmount: '10',
  })]);
  try {
    const unitButton = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Modifier Amount Unit: feet per turn"]',
    );
    assert.ok(unitButton);
    await act(async () => unitButton.click());
    const options = [...rendered.container.querySelectorAll('[role="option"]')]
      .map((option) => option.textContent?.trim());
    assert.deepEqual(options, ['meters per turnm/turn', 'feet per turnft/turn', 'yards per turnyd/turn']);
  } finally {
    await rendered.cleanup();
  }
});

test('guided editor exposes advanced clamp, priority, and condition controls', async () => {
  const rendered = await renderEditor([grant({
    modifierFieldSegments: ['self', 'speed', 'walk', 'rate'],
    modifierOperation: 'at-most',
    modifierAmount: '25',
    modifierAmountUnit: 'ft/turn',
    modifierPriority: '4',
    modifierConditionEnabled: true,
    modifierConditionOperator: 'gte',
    modifierConditionValue: '10',
    modifierConditionUnit: 'ft/turn',
  })]);
  try {
    assert.ok(rendered.container.querySelector(
      'button[aria-label="Modifier Operation: keeps at most"]',
    ));
    assert.ok(rendered.container.querySelector(
      'button[aria-label="Modifier Priority: 4"]',
    ));
    assert.ok(rendered.container.querySelector(
      'button[aria-label="Modifier Condition Operator: is at least"]',
    ));
    assert.ok(rendered.container.querySelector(
      'button[aria-label="Modifier Condition Unit: feet per turn"]',
    ));
    assert.match(rendered.container.textContent ?? '', /when the base value/i);
  } finally {
    await rendered.cleanup();
  }
});

test('guided editor reports an incompatible loaded modifier unit', async () => {
  const rendered = await renderEditor([grant({
    modifierFieldSegments: ['self', 'speed', 'walk', 'rate'],
    modifierAmount: '2',
    modifierAmountUnit: 'ft/turn',
    modifierOperation: 'multiplies',
  })]);
  try {
    assert.match(
      rendered.container.querySelector('[role="alert"]')?.textContent ?? '',
      /must be unitless/i,
    );
  } finally {
    await rendered.cleanup();
  }
});

test('repeated modifier paths render an explicit mount selector', async () => {
  const rendered = await renderEditor([
    grant({
      modifierFieldSegments: ['self', 'dice[]', 'sides'],
      modifierOperation: 'increases',
    }),
  ], ['trait:dice-roll']);
  try {
    const selector = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Modifier Mount Selector: all entries"]',
    );
    assert.ok(selector);
    await act(async () => selector.click());
    const options = [...rendered.container.querySelectorAll('[role="option"]')]
      .map((option) => option.textContent?.trim());
    assert.deepEqual(options, ['all entries', 'entry number', 'specific trait', 'semantic tag']);
  } finally {
    await rendered.cleanup();
  }
});

test('guided grants serialize one selector for every repeated path segment', () => {
  const body = buildGrantsBody([
    grant({
      modifierFieldSegments: ['self', 'groups[]', 'members[]', 'score'],
      modifierAmount: '2',
      modifierMountSelectors: [
        { mode: 'trait', ordinal: '1', traitId: 'trait:red-group', tag: '' },
        { mode: 'tag', ordinal: '1', traitId: '', tag: 'leader' },
      ],
    }),
  ]);

  assert.deepEqual(body.grants[0]?.mountSelectors, [
    { mode: 'trait', traitId: 'trait:red-group' },
    { mode: 'tag', tag: 'leader' },
  ]);
});

test('rendered recursive authoring saves through HTTP before publishing the catalog release', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  let finishPublish!: () => void;
  const publishFinished = new Promise<void>((resolve) => {
    finishPublish = resolve;
  });
  const artifact = definition('trait:winged-boots', 'Winged Boots', []);
  artifact.id = 10;
  const ruleSet: RuleSetResource = {
    id: 1,
    externalId: 'rule-set:acceptance',
    name: 'Acceptance Rules',
    slug: 'acceptance-rules',
    summary: 'Rendered recursive authoring acceptance.',
    lifecycle: 'active',
    engineFeatureLevel: '1',
    dashboard: { featured: false },
    tags: [],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    requests.push({ url, method: init.method ?? 'GET', body });
    if (url === '/api/rule-sets/1/definitions/10') {
      return Response.json({
        ...artifact,
        body: body.body,
        updatedAt: '2026-07-25T00:01:00.000Z',
      });
    }
    if (url === '/api/rule-sets/1/releases') {
      const savedGrants = requests[0]?.body.body as { grants?: Array<Record<string, unknown>> };
      assert.ok(savedGrants.grants?.some((entry) =>
        entry.dataType === 'modifier'
        && entry.operation === 'increases'
        && entry.field === 'self.speed.walk.rate'));
      finishPublish();
      return Response.json({
        id: 20,
        externalId: 'release:acceptance',
        ruleSetId: 1,
        version: body.version,
        contentHash: 'a'.repeat(64),
        engineCompatibility: {},
        dependencyLock: [],
        manifest: {
          formatVersion: 'rule-release/1',
          artifacts: { traitComposition: { metamodelVersion: 'trait/2' } },
        },
        sourceSnapshot: {},
        publishedAt: '2026-07-25T00:02:00.000Z',
        lifecycle: 'published',
        createdAt: '2026-07-25T00:02:00.000Z',
        updatedAt: '2026-07-25T00:02:00.000Z',
      });
    }
    return Response.json({ message: `Unexpected test request: ${url}` }, { status: 500 });
  };

  const rendered = await renderEditor([
    grant({
      _id: 'rate',
      dataType: 'number',
      key: 'rate',
      label: 'Rate',
      min: '0',
      max: '10',
      defaultNum: '5',
      unit: 'ft/turn',
    }),
    grant({
      _id: 'modifier',
      dataType: 'modifier',
      modifierOperation: 'increases',
      modifierFieldSegments: ['self', 'speed', 'walk', 'rate'],
      modifierAmount: '5',
      modifierAmountUnit: 'ft/turn',
    }),
  ], ['trait:creature'], async (grants) => {
    const body = buildGrantsBody(
      grants,
      { mode: 'all', ids: ['trait:creature'] },
      traitDefinitions,
    );
    await updateRuleDefinition(1, artifact.id, {
      body,
      expectedUpdatedAt: artifact.updatedAt,
    });
    const release = await publishRuleSet(ruleSet, {
      version: '1.0.0',
      releaseNotes: 'Recursive authoring acceptance.',
    });
    return `Published ${release.version}`;
  });
  try {
    const publishButton = [...rendered.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Save and publish');
    assert.ok(publishButton);
    await act(async () => {
      publishButton.click();
      await publishFinished;
      await Promise.resolve();
    });
    assert.equal(
      rendered.container.querySelector('[aria-label="Publish status"]')?.textContent,
      'Published 1.0.0',
    );
    assert.deepEqual(
      requests.map(({ url, method }) => ({ url, method })),
      [
        { url: '/api/rule-sets/1/definitions/10', method: 'PATCH' },
        { url: '/api/rule-sets/1/releases', method: 'POST' },
      ],
    );
    assert.equal(requests[1].body.expectedUpdatedAt, now);
    assert.equal(requests[1].body.releaseNotes, 'Recursive authoring acceptance.');
  } finally {
    await rendered.cleanup();
    globalThis.fetch = originalFetch;
  }
});
