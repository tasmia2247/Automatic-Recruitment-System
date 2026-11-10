/** What deleting a job post does (owner, 2026-11-08); shown on the job post page and the vacancy's job post list. */
export function JobPostDeleteNote() {
  return (
    <div className="space-y-2">
      <p>The job post, its circular and its screening criteria are deleted permanently. This cannot be undone.</p>
      <p>Candidates are kept: their applications belong to the vacancy and only lose the link to this post. Mails sent later with its subject are no longer matched to it.</p>
    </div>
  );
}
