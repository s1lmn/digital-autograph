import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Execute the actual github-script policy against synthetic webhook metadata.
const workflow = readFileSync(
  new URL('../../../.github/workflows/pr-policy.yml', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
const script = workflow
  .split('          script: |\n')[1]!
  .split('\n')
  .map((line) => line.slice(12))
  .join('\n');
const template = readFileSync(
  new URL('../../../.github/pull_request_template.md', import.meta.url),
  'utf8',
).replace('EGO-XXX', 'EGO-146');

function proposal() {
  return {
    draft: false,
    title: 'EGO-146: update checkout action',
    body: template,
    user: { login: 'dependabot[bot]' },
    base: { ref: 'main', repo: { full_name: 's1lmn/digital-autograph' } },
    head: {
      ref: 'dependabot/github_actions/actions/checkout-6',
      repo: { full_name: 's1lmn/digital-autograph' },
    },
  };
}

function validate(pr: ReturnType<typeof proposal>, action = 'opened') {
  const errors: string[] = [];
  runInNewContext(script, {
    context: { payload: { pull_request: pr, action } },
    core: {
      setFailed: (message: string) => errors.push(message),
      info: () => {},
    },
  });
  return errors.join('\n');
}

describe('PR Policy for dependency update proposals', () => {
  it('accepts a triaged same-repository Actions bot proposal', () => {
    expect(validate(proposal())).toBe('');
  });

  it('rejects an untriaged bot proposal instead of bypassing metadata', () => {
    const pr = proposal();
    pr.title = 'Bump actions/checkout from 4 to 6';
    pr.body = 'Release notes from upstream';
    const errors = validate(pr);
    expect(errors).toContain('must reference a Linear issue');
    expect(errors).toContain('Missing required PR section: ## Summary');
    expect(errors).toContain('Missing required PR section: ## Validation');
    expect(errors).not.toContain('Branch');
  });

  it('requires every template section even after assigning a Linear issue', () => {
    expect(validate({ ...proposal(), body: 'EGO-146' })).toContain(
      'Missing required PR section: ## Reviewer checklist',
    );
  });

  it.each(['MDBaryshev', 's1lmn', 'github-actions[bot]'])(
    'rejects the reserved bot namespace for author %s',
    (login) => {
      const pr = proposal();
      pr.user.login = login;
      expect(validate(pr)).toContain('does not match the repository workflow');
    },
  );

  it('rejects a fork using the same reserved namespace', () => {
    const pr = proposal();
    pr.head.repo.full_name = 'someone/fork';
    expect(validate(pr)).toContain('does not match the repository workflow');
  });

  it.each([
    'dependabot/npm_and_yarn/next-16.3.8',
    'dependabot/docker/node-24',
    'dependabot/github_actions/',
    'dependabot/github_actions',
  ])('rejects unsupported bot branch %s', (branch) => {
    const pr = proposal();
    pr.head.ref = branch;
    expect(validate(pr)).toContain('does not match the repository workflow');
  });

  it.each([
    'ego-146-checkout',
    'codex/ego-146-checkout',
    's1lm4n/ego-88-public-ci-hardening',
    'chore/checkout',
    'fix/checkout',
  ])('preserves ordinary developer branch %s', (branch) => {
    const pr = proposal();
    pr.user.login = 'MDBaryshev';
    pr.head.ref = branch;
    expect(validate(pr)).toBe('');
  });

  it('still rejects a non-main target', () => {
    const pr = proposal();
    pr.base.ref = 'release';
    expect(validate(pr)).toContain('PR base must normally be main');
  });

  it('still rejects credential-like content in a complete bot template', () => {
    const pr = proposal();
    pr.body += '\nS3_SECRET_ACCESS_KEY=synthetic-canary';
    expect(validate(pr)).toContain('PR body appears to contain a secret');
  });
});

describe('public repository metadata boundary', () => {
  it('uses trusted base policy without checking out or running PR source', () => {
    expect(workflow).toContain('  pull_request_target:');
    expect(workflow).toContain('converted_to_draft');
    expect(workflow).not.toMatch(/^ {4}if:/m);
    expect(workflow).not.toContain('continue-on-error:');
    expect(script).not.toMatch(/core\.notice|core\.warning|process\.exit/);
    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).not.toMatch(
      /actions\/checkout|\n\s+run:|secrets\.|id-token:|write/,
    );
    expect(workflow.match(/uses:/g)).toHaveLength(1);
    expect(workflow).toContain('uses: actions/github-script@v7');
    expect(script).not.toContain('${{');
  });

  it('treats shell and expression syntax in metadata as data', () => {
    const pr = proposal();
    pr.user.login = 'contributor';
    pr.head.repo.full_name = 'contributor/fork';
    pr.head.ref = 'ego-88-public-ci';
    pr.title = 'EGO-88: $(throw new Error()) ${{ secrets.EXAMPLE }}';
    expect(validate(pr)).toBe('');
  });
});

describe('ready-only required metadata status', () => {
  it.each(['opened', 'edited', 'synchronize', 'reopened', 'ready_for_review'])(
    'validates ready metadata on %s',
    (action) => {
      expect(workflow).toContain(action);
      expect(validate(proposal(), action)).toBe('');
      expect(validate({ ...proposal(), body: '' }, action)).toContain(
        'Missing required PR section',
      );
    },
  );

  it.each(['opened', 'converted_to_draft', 'synchronize'])(
    'fails instead of skipping a draft on %s',
    (action) => {
      expect(workflow).toContain(action);
      expect(validate({ ...proposal(), draft: true }, action)).toContain(
        'Draft PR is not ready',
      );
    },
  );

  it('invalidates green metadata after an edit and requires fresh ready validation', () => {
    const pr = proposal();
    expect(validate(pr)).toBe('');
    expect(validate({ ...pr, draft: true }, 'converted_to_draft')).toContain(
      'Draft PR is not ready',
    );
    expect(validate({ ...pr, body: '' }, 'edited')).toContain(
      'Missing required PR section',
    );
    expect(validate(pr, 'ready_for_review')).toBe('');
  });

  it('validates ordinary external forks on synchronization without granting a bot exemption', () => {
    const pr = proposal();
    pr.user.login = 'external-contributor';
    pr.head.repo.full_name = 'external-contributor/fork';
    pr.head.ref = 'ego-88-safe-metadata';
    expect(validate(pr, 'synchronize')).toBe('');
    expect(
      validate({ ...pr, title: 'No issue', body: '' }, 'synchronize'),
    ).toContain('must reference a Linear issue');
  });

  it('handles malicious branch/base/body strings as data and returns only a validation failure', () => {
    const pr = proposal();
    pr.head.ref = 'ego-88-$(throw new Error())';
    pr.base.ref = '${{ secrets.EXAMPLE }}';
    pr.body +=
      '\n${{ secrets.EXAMPLE }}\n`throw new Error()`\n$(throw new Error())';
    expect(validate(pr)).toContain('does not match the repository workflow');
    expect(validate(pr)).toContain('PR base must normally be main');
  });
});

describe('proposed Actions event exception', () => {
  it('allows only the trusted metadata file and only its required event', () => {
    const policy = JSON.parse(
      readFileSync(
        new URL(
          '../../../.github/security/pr-policy-event-policy.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    expect(policy.enforcement).toBe('active');
    expect(policy.conditions).toEqual({
      workflow_path: {
        include: ['.github/workflows/pr-policy.yml'],
        exclude: [],
      },
    });
    expect(policy.rules).toEqual([
      {
        type: 'restrict_action_events',
        parameters: { allowed_events: ['pull_request_target'] },
      },
    ]);
  });
});
