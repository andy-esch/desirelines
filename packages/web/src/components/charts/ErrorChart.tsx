import { PageErrorFallback } from "../PageErrorFallback";

interface ErrorChartProps {
  error: Error;
  onRetry?: () => void;
}

export default function ErrorChart({ error, onRetry }: ErrorChartProps) {
  return <PageErrorFallback error={error} onReset={onRetry} variant="inline" />;
}
