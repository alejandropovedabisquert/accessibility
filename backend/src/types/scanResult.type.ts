import AxeBuilder from "@axe-core/playwright";

type ScanResults = Awaited<
  ReturnType<InstanceType<typeof AxeBuilder>['analyze']>
>;

export { ScanResults };