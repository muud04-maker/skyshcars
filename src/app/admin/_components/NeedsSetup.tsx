import {NEEDS_SETUP_MSG} from '../../../lib/setup';
/** Shown on admin pages whose data source is not set up yet. Details live on the Readiness page only. */
export default function NeedsSetup({what}:{what?:string}){return <div className="setupAlert"><b>{what?`${what}: `:''}needs setup.</b> {NEEDS_SETUP_MSG.replace('This section needs setup. ','')} <a href="/admin/launch">Open Readiness →</a></div>}
