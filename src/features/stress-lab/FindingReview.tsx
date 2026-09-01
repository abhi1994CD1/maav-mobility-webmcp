"use client";

import { useRef, useState, type FormEvent } from "react";
import type { StagedFindingRecord, StressLabStateView } from "@/application/stress-lab-ports";
import styles from "./stress-lab.module.css";

interface FindingReviewProps {
  readonly finding: StagedFindingRecord | null;
  readonly view: StressLabStateView["currentFinding"];
  readonly busy: boolean;
  readonly onAccept: () => void;
  readonly onChallenge: (feedback: string) => void;
}

function claimSubject(claim: StagedFindingRecord["candidate"]["claims"][number]): string {
  return claim.subjectKind === "CONSTRAINT" ? claim.constraintCode : claim.metricKey;
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll("_", " ");
}

function claimValues(claim: StagedFindingRecord["candidate"]["claims"][number]): string {
  if (claim.subjectKind === "CONSTRAINT") {
    return `A ${claim.left.passed ? "PASS" : "FAIL"} · B ${claim.right.passed ? "PASS" : "FAIL"} · ${claim.constraintTransition}`;
  }
  return `A ${claim.leftValue ?? "N/A"} · B ${claim.rightValue ?? "N/A"} · Δ ${claim.rightMinusLeft ?? "N/A"} ${claim.unit}`;
}

export function FindingReview({
  finding,
  view,
  busy,
  onAccept,
  onChallenge,
}: FindingReviewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [feedback, setFeedback] = useState("");
  const feedbackValid =
    feedback.trim().length >= 1 &&
    feedback.trim().length <= 280 &&
    !/[<>\u0000-\u001F\u007F]/u.test(feedback);
  const pending = view?.review === "PENDING_REVIEW";
  const reviewLabel = pending
    ? "PENDING HUMAN REVIEW"
    : view?.review?.replaceAll("_", " ") ?? "NOT STAGED";

  function submitChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!feedbackValid || busy) return;
    onChallenge(feedback.trim());
    dialogRef.current?.close();
    setFeedback("");
  }

  return (
    <section className={`${styles.panel} ${styles.findingPanel}`} aria-labelledby="finding-title">
      <header className={styles.panelHeader}>
        <div>
          <span className={styles.eyebrow}>HUMAN REVIEW BOUNDARY</span>
          <h2 id="finding-title">Evidence-backed finding</h2>
        </div>
        <span className={`${styles.statusBadge} ${pending ? styles.statusWarning : view ? styles.statusSuccess : styles.statusNeutral}`}>
          {reviewLabel}
        </span>
      </header>

      {!finding || !view ? (
        <div className={styles.emptyState}>
          <strong>No staged candidate</strong>
          <p>A trusted comparison can stage a bounded TRADE_OFF / BALANCED candidate.</p>
        </div>
      ) : (
        <>
          <div className={styles.findingIdentity}>
            <div>
              <small>PROPOSED OUTCOME</small>
              <strong>{finding.candidate.selectedOutcome}</strong>
            </div>
            <div>
              <small>OPERATIONAL EMPHASIS</small>
              <strong>{finding.candidate.emphasis}</strong>
            </div>
            <div>
              <small>EVIDENCE RELATIONSHIP</small>
              <strong>{finding.candidate.evidenceRelationship.replaceAll("_", " ")}</strong>
            </div>
          </div>

          <ol className={styles.claimList}>
            {finding.candidate.claims.map((claim, index) => (
              <li key={claim.claimId}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <small>{claim.selectionSlot.replaceAll("_", " ")}</small>
                  <strong>{humanizeIdentifier(claimSubject(claim))}</strong>
                  <p>{claimValues(claim)}</p>
                  <code>{claim.claimId}</code>
                </div>
              </li>
            ))}
          </ol>

          <div className={styles.caveatBox}>
            <h3>Bounded caveats</h3>
            <ul>
              {finding.candidate.caveats.map((caveat) => (
                <li key={caveat.code}>{caveat.code.replaceAll("_", " ")}</li>
              ))}
            </ul>
          </div>

          {view.feedback ? (
            <blockquote className={styles.challengeFeedback}>
              <strong>Human challenge feedback</strong>
              <p>{view.feedback}</p>
            </blockquote>
          ) : null}

          <div className={styles.reviewActions}>
            <button
              type="button"
              className={styles.successButton}
              disabled={!pending || busy}
              onClick={onAccept}
            >
              Accept evidence
            </button>
            <button
              type="button"
              className={styles.dangerButton}
              disabled={!pending || busy}
              onClick={() => dialogRef.current?.showModal()}
            >
              Challenge evidence
            </button>
            <small>Human review records a workflow decision. It does not dispatch or execute a vehicle plan.</small>
          </div>

          <footer className={styles.identityFooter}>
            <div>
              <span>FINDING ARTIFACT</span>
              <code>{finding.id}</code>
            </div>
            <div>
              <span>FINGERPRINT</span>
              <code title={finding.candidate.findingFingerprint}>{finding.candidate.findingFingerprint.slice(0, 30)}…</code>
            </div>
          </footer>
        </>
      )}

      <dialog className={styles.dialog} ref={dialogRef} aria-labelledby="challenge-dialog-title">
        <form method="dialog" onSubmit={submitChallenge}>
          <span className={styles.eyebrow}>HUMAN-ONLY DECISION</span>
          <h2 id="challenge-dialog-title">Challenge this finding</h2>
          <p>Record bounded plain-text feedback without changing the trusted evidence.</p>
          <label htmlFor="challenge-feedback">Challenge feedback</label>
          <textarea
            id="challenge-feedback"
            value={feedback}
            maxLength={280}
            rows={4}
            aria-invalid={feedback.length > 0 && !feedbackValid}
            aria-describedby="challenge-feedback-help"
            onChange={(event) => setFeedback(event.currentTarget.value)}
          />
          <small id="challenge-feedback-help">1–280 plain-text characters. HTML and control characters are rejected.</small>
          <div className={styles.dialogActions}>
            <button type="button" className={styles.secondaryButton} onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button type="submit" className={styles.dangerButton} disabled={!feedbackValid || busy}>
              Record challenge
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
