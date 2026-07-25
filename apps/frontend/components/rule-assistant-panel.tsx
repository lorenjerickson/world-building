'use client';

import { useRef, useState } from 'react';
import {
  AssistantDraftDefinitionPatch,
  AssistantMessage,
  AssistantParsedParameter,
  AssistantProposedDefinition,
  AssistantResponse,
  sendAssistantMessage,
} from '@/lib/rule-authoring';
import { RuleDefinitionResource, createRuleDefinition, RuleDefinitionType } from '@/lib/rule-sets';

// ── Types ──────────────────────────────────────────────────────────────────────

type ProposalState = 'pending' | 'accepted' | 'discarded';

type TrackedProposal = {
  id: string;
  definition: AssistantProposedDefinition;
  state: ProposalState;
};

type TurnEntry = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  response?: AssistantResponse;
  proposals?: TrackedProposal[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function definitionTypeFromBody(body: Record<string, unknown>): RuleDefinitionType {
  return (body.definitionType as RuleDefinitionType | undefined) ?? 'trait';
}

function nameFromBody(body: Record<string, unknown>): string {
  return typeof body.name === 'string' ? body.name : 'Untitled';
}

function formatParserParameter(parameter: AssistantParsedParameter): string {
  if (parameter.kind === 'dice' && typeof parameter.value === 'object' && parameter.value !== null) {
    const value = parameter.value as { count: number; sides: number; modifier: number };
    const modifier = value.modifier === 0 ? '' : value.modifier > 0 ? `+${value.modifier}` : `${value.modifier}`;
    return `${value.count}d${value.sides}${modifier}`;
  }
  if (parameter.kind === 'number') {
    return `${String(parameter.value)}${parameter.unit ? ` ${parameter.unit}` : ''}`;
  }
  return String(parameter.value);
}

// ── Proposal card ─────────────────────────────────────────────────────────────

function ProposalCard({
  proposal,
  onAccept,
  onDiscard,
}: {
  proposal: TrackedProposal;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const body = proposal.definition.body;
  const name = nameFromBody(body);
  const type = definitionTypeFromBody(body);

  return (
    <div className={`rule-assistant-proposal-card ${proposal.state}`}>
      <div className="rule-assistant-proposal-header">
        <div>
          <strong>{name}</strong>
          <span className="badge">{type}</span>
          {!proposal.definition.valid && <span className="badge error">invalid</span>}
        </div>
        <div className="rule-assistant-proposal-actions">
          {proposal.state === 'pending' && (
            <>
              <button type="button" className="secondary-action compact-action" onClick={onAccept} disabled={!proposal.definition.valid}>Accept</button>
              <button type="button" className="secondary-action compact-action" onClick={onDiscard}>Discard</button>
            </>
          )}
          {proposal.state === 'accepted' && <span className="rule-assistant-proposal-status accepted">Accepted</span>}
          {proposal.state === 'discarded' && <span className="rule-assistant-proposal-status discarded">Discarded</span>}
        </div>
      </div>
      {proposal.definition.diagnostics.length > 0 && (
        <ul className="guided-rule-diagnostics">{proposal.definition.diagnostics.map((d) => <li key={`${d.code}-${d.path}`}><span>{d.path}</span>{d.message}</li>)}</ul>
      )}
      <button type="button" className="rule-assistant-proposal-toggle" onClick={() => setExpanded((v) => !v)}>{expanded ? 'Hide JSON' : 'Show JSON'}</button>
      {expanded && <pre className="rule-assistant-proposal-json">{JSON.stringify(body, null, 2)}</pre>}
    </div>
  );
}

// ── Turn renderer ─────────────────────────────────────────────────────────────

function TurnView({
  turn,
  onAccept,
  onDiscard,
}: {
  turn: TurnEntry;
  onAccept: (proposalId: string) => void;
  onDiscard: (proposalId: string) => void;
}) {
  const parser = turn.response?.parser;
  const parserSlots = parser?.slots ?? [];
  const parserPatches = parser?.draftDefinitionPatches ?? [];

  return (
    <div className={`rule-assistant-turn ${turn.role}`}>
      <div className="rule-assistant-bubble">
        <p>{turn.content}</p>
      </div>
      {turn.role === 'assistant' && turn.response && (
        <div className="rule-assistant-extras">
          {(parserSlots.length > 0 || parserPatches.length > 0) && (
            <details className="rule-assistant-parser" open={parserSlots.length > 0}>
              <summary>
                Parser extraction
                <span className="rule-assistant-parser-count">{parserSlots.length} sentence{parserSlots.length === 1 ? '' : 's'} · {parserPatches.length} draft patch{parserPatches.length === 1 ? '' : 'es'}</span>
              </summary>
              {parserSlots.length > 0 && (
                <div className="rule-assistant-parser-slots">
                  {parserSlots.map((slot, index) => (
                    <article key={`${slot.sentence}-${index}`} className="rule-assistant-parser-slot">
                      <header>
                        <strong>{slot.capability || slot.subject || `Sentence ${index + 1}`}</strong>
                        <span>confidence {(slot.confidence * 100).toFixed(0)}%</span>
                      </header>
                      <p>{slot.sentence}</p>
                      <dl>
                        {slot.subject && <><dt>Subject</dt><dd>{slot.subject}</dd></>}
                        {slot.capability && <><dt>Capability</dt><dd>{slot.capability}</dd></>}
                        {slot.predicates.length > 0 && <><dt>Predicates</dt><dd>{slot.predicates.join(' · ')}</dd></>}
                        {slot.parameters.length > 0 && (
                          <>
                            <dt>Parameters</dt>
                            <dd>{slot.parameters.map((parameter) => `${parameter.name}: ${formatParserParameter(parameter)}`).join(' · ')}</dd>
                          </>
                        )}
                      </dl>
                    </article>
                  ))}
                </div>
              )}
              {parserPatches.length > 0 && (
                <div className="rule-assistant-parser-patches">
                  <strong>Draft definition patch ideas</strong>
                  <ul>
                    {parserPatches.map((patch: AssistantDraftDefinitionPatch, index) => (
                      <li key={`${patch.name}-${index}`}>
                        <span className="badge">{patch.definitionType}</span>
                        <span>{patch.name}</span>
                        <small>{patch.rationale}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </details>
          )}
          {turn.response.questions.length > 0 && (
            <div className="rule-assistant-questions">
              <strong>Clarifying questions:</strong>
              <ul>{turn.response.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </div>
          )}
          {turn.response.assumptions.length > 0 && (
            <details className="rule-assistant-assumptions"><summary>Assumptions made</summary><ul>{turn.response.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></details>
          )}
          {turn.proposals && turn.proposals.length > 0 && (
            <div className="rule-assistant-proposals">
              <strong>Proposed definitions</strong>
              {turn.proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  onAccept={() => onAccept(proposal.id)}
                  onDiscard={() => onDiscard(proposal.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function RuleAssistantPanel({
  ruleSetId,
  moduleId,
  contextDefinitions,
  onDefinitionCreated,
}: {
  ruleSetId: number;
  moduleId: number;
  contextDefinitions: Record<string, unknown>[];
  onDefinitionCreated: (definition: RuleDefinitionResource) => void;
}) {
  const [turns, setTurns] = useState<TurnEntry[]>([]);
  const [proposals, setProposals] = useState<Record<string, TrackedProposal>>({});
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function buildHistory(): AssistantMessage[] {
    return turns.flatMap((turn): AssistantMessage[] => {
      const user: AssistantMessage = { role: 'user', content: turn.content };
      if (turn.role === 'user') return [user];
      if (turn.response) return [user, { role: 'assistant', content: turn.response.explanation }];
      return [user];
    });
  }

  async function send() {
    const text = message.trim();
    if (!text || sending) return;
    setError(undefined);
    setSending(true);
    const userTurnId = uid();
    const userTurn: TurnEntry = { id: userTurnId, role: 'user', content: text };
    setTurns((prev) => [...prev, userTurn]);
    setMessage('');

    try {
      const history = buildHistory();
      const response = await sendAssistantMessage({ message: text, history, context: { definitions: contextDefinitions } });

      if (!response.llmAvailable) {
        setUnavailable(true);
      }

      if (!response.llmAvailable) {
        const parserOnlyTurn: TurnEntry = {
          id: uid(),
          role: 'assistant',
          content: response.explanation,
          response,
          proposals: [],
        };
        setTurns((prev) => [...prev, parserOnlyTurn]);
        return;
      }

      const turnProposals: TrackedProposal[] = response.definitions.map((def) => {
        const id = uid();
        const proposal: TrackedProposal = { id, definition: def, state: 'pending' };
        return proposal;
      });

      const newProposalMap: Record<string, TrackedProposal> = {};
      for (const p of turnProposals) newProposalMap[p.id] = p;
      setProposals((prev) => ({ ...prev, ...newProposalMap }));

      const assistantTurn: TurnEntry = {
        id: uid(),
        role: 'assistant',
        content: response.explanation,
        response,
        proposals: turnProposals,
      };
      setTurns((prev) => [...prev, assistantTurn]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to reach the assistant.');
      setTurns((prev) => prev.filter((t) => t.id !== userTurnId));
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function acceptProposal(proposalId: string) {
    const proposal = proposals[proposalId];
    if (!proposal || !proposal.definition.valid) return;
    const body = proposal.definition.body;
    createRuleDefinition(ruleSetId, {
      body,
      definitionType: definitionTypeFromBody(body),
      description: typeof body.description === 'string' ? body.description : undefined,
      moduleId,
      name: nameFromBody(body),
      tags: [],
      visibility: 'exported',
    })
      .then((definition) => {
        setProposals((prev) => ({ ...prev, [proposalId]: { ...prev[proposalId], state: 'accepted' } }));
        setTurns((prev) =>
          prev.map((turn) => ({
            ...turn,
            proposals: turn.proposals?.map((p) => p.id === proposalId ? { ...p, state: 'accepted' } : p),
          })),
        );
        onDefinitionCreated(definition);
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : 'Failed to create definition.');
      });
  }

  function discardProposal(proposalId: string) {
    setProposals((prev) => ({ ...prev, [proposalId]: { ...prev[proposalId], state: 'discarded' } }));
    setTurns((prev) =>
      prev.map((turn) => ({
        ...turn,
        proposals: turn.proposals?.map((p) => p.id === proposalId ? { ...p, state: 'discarded' } : p),
      })),
    );
  }

  if (unavailable) {
    // Keep the panel usable in parser-only mode when no LLM is configured.
  }

  return (
    <div className="rule-assistant-panel rule-set-child-form">
      {unavailable && <p className="rule-set-notice">LLM is unavailable. Parser-only extraction is active. Configure <code>OPENAI_API_KEY</code> or a local model to receive full assistant proposals.</p>}
      <div className="rule-assistant-turn-list">
        {turns.length === 0 && (
          <p className="rule-assistant-empty">Describe a creature ability, resolution mechanic, or trait you'd like to add. The assistant will propose typed rule definitions you can review and accept one by one.</p>
        )}
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} onAccept={acceptProposal} onDiscard={discardProposal} />
        ))}
        {sending && <div className="rule-assistant-turn assistant rule-assistant-thinking"><div className="rule-assistant-bubble"><p>Thinking…</p></div></div>}
      </div>
      {error && <p className="rule-set-notice error" role="alert">{error}</p>}
      <div className="rule-assistant-input-row">
        <textarea
          ref={inputRef}
          className="rule-assistant-input"
          rows={3}
          placeholder="Ask the assistant to draft a rule definition…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
          disabled={sending}
        />
        <button type="button" className="primary-action compact-action" onClick={send} disabled={sending || !message.trim()}>Send</button>
      </div>
      <p className="subtext">⌘↵ to send · Proposals are validated before you accept them.</p>
    </div>
  );
}
