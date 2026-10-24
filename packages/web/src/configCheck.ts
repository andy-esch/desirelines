// index.tsx imports this module before anything else. ES modules run in import
// order, and the app's imports reach lib/firebase.ts, which reads the
// configuration as it loads; a check in index.tsx's own body would run too late
// to show the error page, leaving a blank one.
import { validateConfigOrShowError } from "./lib/configErrorPage";

validateConfigOrShowError();
