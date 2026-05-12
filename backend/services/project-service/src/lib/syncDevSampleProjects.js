const { v5: uuidv5 } = require('uuid');

/** Deterministic UUIDs so re-runs do not duplicate rows. */
const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const OWNER_EMAIL =
  (process.env.DEV_SAMPLE_PROJECTS_OWNER_EMAIL || 'dev-student-01@acadconnect.test')
    .trim()
    .toLowerCase();

/**
 * Ten catalog-style projects (software engineering + computer science).
 * Each has one paragraph description and one paragraph abstract.
 */
const SAMPLE_PROJECTS = [
  {
    slug: 'se-cicd-quality-gates',
    title: 'CI/CD Quality Gates for Student Teams',
    description:
      'This project designs a lightweight continuous integration workflow that student software teams can adopt without dedicated DevOps staff. It focuses on defining sensible default checks—linting, unit tests, coverage thresholds, and dependency audits—that run on every pull request. The team will document how to configure GitHub Actions or GitLab CI for a typical web service stack and how to fail fast when quality regresses. Deliverables include example pipelines, a decision guide for when to add stricter gates, and a short evaluation with two real repositories from prior coursework.',
    abstract:
      'We propose a practical CI/CD quality gate template for small academic software teams, emphasizing automated checks on each merge request and clear rollback policies. The work spans pipeline design, static analysis integration, and measurable quality metrics suitable for capstone-scale applications.',
  },
  {
    slug: 'se-observability-dashboard',
    title: 'Microservice Observability Dashboard',
    description:
      'Modern distributed systems fail in subtle ways; this project builds a minimal observability dashboard that aggregates logs, metrics, and traces from a handful of containerized services. Students will instrument sample microservices with OpenTelemetry, ship data to a local collector, and render latency and error-rate charts in a simple web UI. The emphasis is on actionable views for on-call style debugging rather than enterprise-scale storage. The outcome is a reproducible docker-compose stack and a README that teaches peers how to extend it.',
    abstract:
      'This effort delivers an end-to-end observability path for a toy microservice mesh, combining structured logging, RED metrics, and trace correlation in a single developer-friendly dashboard aimed at software engineering education.',
  },
  {
    slug: 'se-agile-metrics',
    title: 'Agile Metrics and Sprint Forecasting Toolkit',
    description:
      'Agile ceremonies generate rich historical data that teams rarely analyze systematically. This project implements a small analytics toolkit that ingests synthetic or anonymized sprint data—velocity, carry-over, defect counts—and produces readable forecasts for the next iteration. The toolkit should highlight assumptions, visualize variance, and avoid false precision. Students will validate the approach against textbook agile scenarios and document ethical limits when applying forecasts to individual contributors.',
    abstract:
      'We build a transparent sprint forecasting toolkit grounded in historical velocity and cycle time, packaged so student teams can reason about delivery risk without micromanagement or biased rankings.',
  },
  {
    slug: 'se-campus-api-design',
    title: 'API Design for Campus Digital Services',
    description:
      'Universities expose dozens of overlapping digital services; inconsistent APIs frustrate integrators. This project specifies a resource-oriented HTTP API for a fictional campus module—room booking or office hours—with pagination, versioning, error models, and idempotent mutations where appropriate. The team will produce an OpenAPI document, example server stubs, and consumer-focused documentation. Security topics include least-privilege scopes and rate limiting patterns appropriate for on-campus clients.',
    abstract:
      'The project centers on a versioned, documented REST API for a campus-facing workflow, illustrating pragmatic authentication, error handling, and evolution strategies for long-lived educational software.',
  },
  {
    slug: 'se-tech-debt-analyzer',
    title: 'Technical Debt Analyzer for JavaScript Codebases',
    description:
      'Technical debt accumulates through duplicated logic, oversized modules, and outdated dependencies. This project prototypes a static analyzer that scans JavaScript or TypeScript repositories and emits a prioritized debt report combining complexity heuristics, dependency age, and test coverage gaps where available. The analyzer should be fast enough for mid-size class projects and configurable via a YAML profile. Evaluation compares findings against manual audits on two open-source samples.',
    abstract:
      'We introduce a configurable static analysis pipeline that surfaces actionable technical debt signals in student-scale JS/TS repositories, balancing precision with low setup cost for software engineering courses.',
  },
  {
    slug: 'cs-gnn-link-prediction',
    title: 'Graph Neural Networks for Citation Link Prediction',
    description:
      'Citation networks encode latent relationships between papers beyond explicit references. This project explores graph neural network architectures—such as GraphSAGE or GCN variants—to predict missing or future links in a subset of a public citation graph. Students will preprocess node features, handle class imbalance, and report metrics that reflect realistic evaluation splits. The work stresses reproducibility: fixed seeds, documented hyperparameters, and ablations on depth and hidden width.',
    abstract:
      'We study inductive link prediction on citation graphs using graph neural networks, comparing shallow and deeper message-passing designs while documenting generalization under temporal splits relevant to computer science literature mining.',
  },
  {
    slug: 'cs-federated-learning',
    title: 'Secure Multi-Party Federated Learning Prototype',
    description:
      'Federated learning promises collaborative model training without centralizing raw data, but naive implementations leak information through gradients. This project implements a small federated averaging loop across three simulated clients with optional differential privacy noise and secure aggregation sketches at the protocol level. The team will train a simple classifier on partitioned tabular data and measure accuracy–privacy trade-offs. Threat modeling write-ups describe honest-but-curious servers and mitigation choices appropriate for classroom scope.',
    abstract:
      'This prototype demonstrates federated averaging with basic privacy mitigations across simulated clients, quantifying utility loss when noise or gradient clipping is applied in a computer science research setting.',
  },
  {
    slug: 'cs-embedded-filesystem',
    title: 'Rust-Based Embedded Log-Structured File System',
    description:
      'Embedded devices benefit from crash-safe, wear-aware storage layouts. This project implements a minimal log-structured file system layer in Rust targeting a QEMU-backed flash emulator or a provided block device interface. Key goals include append-only writes, garbage collection basics, and metadata journaling sufficient to recover after power loss tests. Documentation explains design trade-offs versus FAT-like layouts and how Rust’s ownership model helps prevent use-after-free bugs in I/O paths.',
    abstract:
      'We design and implement a compact log-structured file system in Rust for embedded targets, emphasizing crash consistency, wear leveling hooks, and memory safety in low-level storage code typical of computer systems courses.',
  },
  {
    slug: 'cs-post-quantum-kex',
    title: 'Quantum-Resistant Key Exchange Classroom Prototype',
    description:
      'Post-quantum cryptography is transitioning from standards drafts to libraries developers can call today. This project prototypes a key encapsulation mechanism workflow using a vetted lattice-based KEM available through a maintained library, integrated into a toy TLS-like handshake between two processes. Students will profile message sizes and handshake latency compared to classical ECDH and summarize deployment caveats such as hybrid modes. The emphasis is on correct API usage and clear explanations rather than inventing new cryptography.',
    abstract:
      'The work delivers a pedagogical prototype of a post-quantum key exchange integrated into a minimal secure channel, highlighting message size impacts and safe integration patterns without custom cryptographic constructions.',
  },
  {
    slug: 'cs-llvm-peephole',
    title: 'Peephole Optimizations on LLVM IR',
    description:
      'Compilers improve programs through sequences of local rewrite rules. This project implements a small set of peephole optimizations as an LLVM pass or an IR-to-IR transformation tool that reads LLVM bitcode text, applies patterns such as redundant load elimination or strength reduction on idiomatic examples, and validates correctness with lit-style tests. Students will measure static instruction counts before and after on microbenchmarks and discuss interactions with later optimization phases.',
    abstract:
      'We implement and evaluate a focused collection of peephole optimizations over LLVM IR, demonstrating measurable instruction reductions on curated microbenchmarks while preserving semantics via automated regression tests.',
  },
];

/**
 * Inserts sample projects for local/demo environments (idempotent).
 * @param {import('knex').Knex} knex
 * @returns {Promise<{ inserted: number, skipped: boolean, reason?: string }>}
 */
async function syncDevSampleProjects(knex) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SEED_IN_PRODUCTION !== '1') {
    return { inserted: 0, skipped: true, reason: 'production' };
  }
  if (process.env.DISABLE_DEV_SAMPLE_PROJECTS === '1') {
    return { inserted: 0, skipped: true, reason: 'disabled' };
  }

  const owner = await knex('users')
    .whereRaw('LOWER(TRIM(email)) = ?', [OWNER_EMAIL])
    .where('role', 'student')
    .first();

  if (!owner) {
    return { inserted: 0, skipped: true, reason: `no student user ${OWNER_EMAIL}` };
  }

  let inserted = 0;
  for (const p of SAMPLE_PROJECTS) {
    const id = uuidv5(`acadconnect:sample-project:${p.slug}`, NS);
    const exists = await knex('projects').where({ id }).first();
    if (exists) continue;

    await knex('projects').insert({
      id,
      group_id: null,
      creator_student_id: owner.id,
      title: p.title,
      description: p.description,
      abstract: p.abstract,
      status: 'open',
      recruitment_status: 'looking_for_3',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
    inserted += 1;
  }

  return { inserted, skipped: false };
}

module.exports = { syncDevSampleProjects, SAMPLE_PROJECTS, OWNER_EMAIL };
