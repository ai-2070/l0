/**
 * Enable all L0 optional features
 *
 * This module enables all optional L0 features (monitoring, drift detection,
 * interceptors, adapter registry) for testing environments.
 *
 * Import this file before running tests to ensure all features are available:
 *   import "../tests/enable-features";
 */

import {
  enableDriftDetection,
  enableMonitoring,
  enableInterceptors,
  enableAdapterRegistry,
} from "../src/runtime/l0";
import { DriftDetector } from "../src/runtime/drift";
import { L0Monitor, type MonitoringConfig } from "../src/runtime/monitoring";
import { InterceptorManager } from "../src/runtime/interceptors";
import type { L0Interceptor } from "../src/types/l0";
import {
  getAdapter,
  hasMatchingAdapter,
  detectAdapter,
} from "../src/adapters/registry";

// Enable all features
enableDriftDetection(() => new DriftDetector());
enableMonitoring(
  (config) => new L0Monitor(config as Partial<MonitoringConfig>),
);
enableInterceptors(
  (interceptors) => new InterceptorManager(interceptors as L0Interceptor[]),
);
enableAdapterRegistry({
  getAdapter,
  hasMatchingAdapter,
  detectAdapter,
});
