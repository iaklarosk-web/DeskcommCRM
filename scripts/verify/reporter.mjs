import { JsonReporter } from "vitest/node";

/** Preserve the native report, identifying executed it.fails separately. */
export default class VerifyReporter extends JsonReporter {
  constructor(options = {}) {
    super(options);
  }

  async onTestRunEnd(modules) {
    for (const testModule of modules) {
      for (const test of testModule.children.allTests()) {
        test.meta().verifyExpectedFailure = test.options.fails === true;
      }
    }
    await super.onTestRunEnd(modules);
  }
}
