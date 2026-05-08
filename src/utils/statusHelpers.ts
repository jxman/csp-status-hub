import type { StatusLevel } from '../types/status';

export function statusColor(status: StatusLevel): string {
  switch (status) {
    case 'operational': return 'bg-green-500';
    case 'degraded': return 'bg-yellow-400';
    case 'outage': return 'bg-red-500';
    case 'unknown': return 'bg-gray-400';
  }
}

export function statusTextColor(status: StatusLevel): string {
  switch (status) {
    case 'operational': return 'text-green-700 dark:text-green-400';
    case 'degraded': return 'text-yellow-700 dark:text-yellow-400';
    case 'outage': return 'text-red-700 dark:text-red-400';
    case 'unknown': return 'text-gray-500 dark:text-gray-400';
  }
}

export function statusLabel(status: StatusLevel): string {
  switch (status) {
    case 'operational': return 'Operational';
    case 'degraded': return 'Degraded';
    case 'outage': return 'Outage';
    case 'unknown': return 'Unknown';
  }
}

export function statusDot(status: StatusLevel): string {
  switch (status) {
    case 'operational': return '🟢';
    case 'degraded': return '🟡';
    case 'outage': return '🔴';
    case 'unknown': return '⚪';
  }
}

export function severityLabel(severity: 'low' | 'medium' | 'high'): string {
  switch (severity) {
    case 'high': return 'High';
    case 'medium': return 'Medium';
    case 'low': return 'Low';
  }
}

export function severityColor(severity: 'low' | 'medium' | 'high'): string {
  switch (severity) {
    case 'high': return 'text-red-600 dark:text-red-400';
    case 'medium': return 'text-yellow-600 dark:text-yellow-400';
    case 'low': return 'text-blue-600 dark:text-blue-400';
  }
}
