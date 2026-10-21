import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  MONITORING_REFRESH_INTERVAL_MS,
} from '../services/monitoringFacade.js';
import {
  isPlainObject,
} from '../validation/schemas.js';

const DEFAULT_TIMER_KEY = 'monitoring-route-playback';

function requireOptions(value) {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new TypeError(
      'Monitoring playback hook options must be a plain object.',
    );
  }

  return value;
}

function resolveArguments(facadeOrOptions, options) {
  if (
    isPlainObject(facadeOrOptions) &&
    facadeOrOptions.monitoringFacade !== undefined
  ) {
    return {
      facade: facadeOrOptions.monitoringFacade,
      options: facadeOrOptions,
    };
  }

  return {
    facade: facadeOrOptions,
    options: requireOptions(options),
  };
}

function requireMonitoringFacade(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.getDashboard !== 'function' ||
    typeof value.refreshOnce !== 'function' ||
    typeof value.startRefresh !== 'function'
  ) {
    throw new TypeError(
      'useMonitoringPlayback requires a MonitoringFacade with getDashboard(), refreshOnce(), and startRefresh().',
    );
  }

  return value;
}

function normalizeEnabled(value) {
  if (value === undefined) {
    return true;
  }

  if (typeof value !== 'boolean') {
    throw new TypeError(
      'Monitoring playback enabled option must be a boolean.',
    );
  }

  return value;
}

function normalizeInterval(value) {
  if (value === undefined) {
    return MONITORING_REFRESH_INTERVAL_MS;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(
      'Monitoring playback interval must be a non-negative finite number.',
    );
  }

  return value;
}

function normalizeTimerKey(value) {
  if (value === undefined) {
    return DEFAULT_TIMER_KEY;
  }

  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > 200
  ) {
    throw new TypeError(
      'Monitoring playback timer key must be a non-empty string of at most 200 characters.',
    );
  }

  return value.normalize('NFC').trim();
}

function normalizeOperationError(error) {
  if (error instanceof Error) {
    return error;
  }

  const normalized = new Error(
    'The simulated monitoring operation could not be completed.',
  );

  if (
    error !== null &&
    typeof error === 'object' &&
    typeof error.code === 'string'
  ) {
    normalized.code = error.code;
  }

  return normalized;
}

function readDashboardResult(result) {
  if (
    !isPlainObject(result) ||
    result.ok !== true ||
    !isPlainObject(result.data)
  ) {
    const error = new Error(
      result?.error?.message ??
        'The simulated monitoring dashboard could not be loaded.',
    );

    error.code =
      typeof result?.error?.code === 'string'
        ? result.error.code
        : 'DASHBOARD_FAILED';
    throw error;
  }

  const dashboard = isPlainObject(result.data.dashboard)
    ? result.data.dashboard
    : result.data;

  if (!isPlainObject(dashboard)) {
    const error = new Error(
      'The monitoring facade returned an invalid dashboard.',
    );

    error.code = 'INVALID_DASHBOARD';
    throw error;
  }

  return dashboard;
}

/**
 * Starts route-scoped deterministic monitoring playback and cancels its timer
 * when the consuming component unmounts.
 *
 * @param {object|Record<string, unknown>} facadeOrOptions Monitoring facade or
 * options containing `monitoringFacade`.
 * @param {{
 *   enabled?: boolean,
 *   intervalMs?: number,
 *   timerKey?: string
 * }} [options] Playback options.
 * @returns {Readonly<Record<string, unknown>>} Monitoring playback state.
 */
export function useMonitoringPlayback(
  facadeOrOptions,
  options = {},
) {
  const resolved = resolveArguments(
    facadeOrOptions,
    options,
  );
  const normalizedOptions = requireOptions(resolved.options);
  const facade = requireMonitoringFacade(resolved.facade);
  const enabled = normalizeEnabled(normalizedOptions.enabled);
  const intervalMs = normalizeInterval(
    normalizedOptions.intervalMs,
  );
  const timerKey = normalizeTimerKey(
    normalizedOptions.timerKey,
  );
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [operationError, setOperationError] = useState(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setOperationError(null);

    try {
      const result = await facade.refreshOnce();
      const nextDashboard = readDashboardResult(result);

      setDashboard(nextDashboard);
      return nextDashboard;
    } catch (error) {
      const normalizedError = normalizeOperationError(error);

      setOperationError(normalizedError);
      throw normalizedError;
    } finally {
      setRefreshing(false);
    }
  }, [facade]);

  const clearOperationError = useCallback(() => {
    setOperationError(null);
  }, []);

  useEffect(() => {
    let active = true;
    let cancelPlayback = null;

    setPlaying(false);

    if (!enabled) {
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setOperationError(null);

    try {
      cancelPlayback = facade.startRefresh({
        intervalMs,
        timerKey,
        immediate: false,
        onTick(result) {
          if (!active) {
            return;
          }

          try {
            setDashboard(readDashboardResult(result));
            setOperationError(null);
          } catch (error) {
            setOperationError(
              normalizeOperationError(error),
            );
          }
        },
      });
      setPlaying(true);
    } catch (error) {
      setOperationError(normalizeOperationError(error));
    }

    const loadDashboard = async () => {
      try {
        const result = await facade.getDashboard();
        const nextDashboard = readDashboardResult(result);

        if (active) {
          setDashboard(nextDashboard);
        }
      } catch (error) {
        if (active) {
          setOperationError(
            normalizeOperationError(error),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadDashboard();

    return () => {
      active = false;

      if (typeof cancelPlayback === 'function') {
        cancelPlayback();
      }
    };
  }, [enabled, facade, intervalMs, timerKey]);

  return useMemo(
    () =>
      Object.freeze({
        dashboard,
        data: dashboard,
        loading,
        isLoading: loading,
        refreshing,
        isRefreshing: refreshing,
        playing,
        isPlaying: playing,
        error: operationError,
        operationError,
        enabled,
        intervalMs,
        refresh,
        refreshOnce: refresh,
        clearOperationError,
      }),
    [
      clearOperationError,
      dashboard,
      enabled,
      intervalMs,
      loading,
      operationError,
      playing,
      refresh,
      refreshing,
    ],
  );
}

export default useMonitoringPlayback;