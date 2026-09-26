#!/usr/bin/env node
import { App } from 'aws-cdk-lib/core';
import { ContextParameters } from '../utils/context';
import { MainStack } from '../lib/main-stack';

const app = new App();
const context = new ContextParameters(app);

const mainStackId = context.getResourceId("main-stack");
new MainStack(app, mainStackId, {
  env: {
    region: context.stageParameters.region,
  },
  context: context,
});
