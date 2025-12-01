/**
 * Test setup - enables all L0 features for testing
 *
 * This file is run before all tests to ensure all optional features
 * (monitoring, drift detection, interceptors, adapter registry) are available.
 */

import {
  enableDriftDetection,
  enableMonitoring,
  enableInterceptors,
  enableAdapterRegistry,
} from "../src/runtime/l0";
import { DriftDetector } from "../src/runtime/drift";
import { L0Monitor } from "../src/runtime/monitoring";
import { InterceptorManager } from "../src/runtime/interceptors";
import {
  getAdapter,
  hasMatchingAdapter,
  detectAdapter,
} from "../src/adapters/registry";

// Enable all features for tests
enableDriftDetection(() => new DriftDetector());
enableMonitoring((config) => new L0Monitor(config));
enableInterceptors((interceptors) => new InterceptorManager(interceptors));
enableAdapterRegistry({
  getAdapter,
  hasMatchingAdapter,
  detectAdapter,
});
