/** Current end-to-end entry: both task generations use the same CLI/node contract.
 * Resource, team and project CRUD journeys retain their dedicated browser suites.
 * No native tool or external model is launched by these isolated checks.
 */
await import('./workflow-http.js');
await import('./collaboration-cli.js');
await import('./unified-delivery-browser.js');
export {};
