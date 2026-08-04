import { Module } from "@medusajs/framework/utils";
import InboxModuleService from "./service";

/**
 * The inbound email inbox.
 *
 * Registered in `medusa-config.ts` unconditionally, independent of
 * `INBOX_ENABLED`: the switch governs whether mail is *imported*, not whether
 * already-imported mail can be read. Turning the importer off must not make the
 * admin page start failing on messages it already holds.
 */
export const INBOX_MODULE = "inbox";

export default Module(INBOX_MODULE, {
  service: InboxModuleService,
});
