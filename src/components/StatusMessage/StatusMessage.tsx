/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */
import './StatusMessage.css';

type StatusTone = 'info' | 'win' | 'loss';

interface StatusMessageProps {
  message: string;
  variant?: StatusTone;
}

export function StatusMessage({ message, variant = 'info' }: StatusMessageProps) {
  if (!message) {
    return null;
  }

  return (
      <div className={`status-message tone-${variant}`}>
        <span className="status-text">{message}</span>
      </div>
  );
}
