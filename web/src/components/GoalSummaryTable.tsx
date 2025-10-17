import React from 'react';
import { Goals } from '../utils/goalCalculations';

interface GoalSummaryTableProps {
  goals: Goals;
  currentDistance: number;
  year: number;
}

const GoalSummaryTable: React.FC<GoalSummaryTableProps> = ({
  goals,
  currentDistance,
  year,
}) => {
  const today = new Date();
  const isCurrentYear = year === today.getFullYear();

  const calculateDaysRemaining = (): number => {
    if (!isCurrentYear) return 0;
    const endOfYear = new Date(year, 11, 31);
    const msPerDay = 1000 * 60 * 60 * 24;
    return Math.ceil((endOfYear.getTime() - today.getTime()) / msPerDay);
  };

  const calculateDailyPaceNeeded = (goalValue: number): number => {
    const daysRemaining = calculateDaysRemaining();
    if (daysRemaining <= 0) return 0;

    const distanceRemaining = Math.max(0, goalValue - currentDistance);
    return distanceRemaining / daysRemaining;
  };

  const calculateProgress = (goalValue: number): number => {
    return goalValue > 0 ? (currentDistance / goalValue) * 100 : 0;
  };

  const getStatusText = (goalValue: number): string => {
    const progress = calculateProgress(goalValue);
    if (progress >= 100) return 'Achieved ✓';
    if (progress >= 90) return 'Nearly There';
    if (progress >= 75) return 'On Track';
    if (progress >= 50) return 'Behind';
    return 'Far Behind';
  };

  const getStatusColor = (goalValue: number): string => {
    const progress = calculateProgress(goalValue);
    if (progress >= 100) return 'success';
    if (progress >= 75) return 'info';
    if (progress >= 50) return 'warning';
    return 'danger';
  };

  const daysRemaining = calculateDaysRemaining();

  // Sort goals by value for display
  const sortedGoals = [...goals].sort((a, b) => a.value - b.value);

  return (
    <div className="card mb-4">
      <div className="card-header">
        <h5>Goal Achievability Summary</h5>
      </div>
      <div className="card-body">
        <div className="table-responsive">
          <table className="table table-hover table-sm">
            <thead>
              <tr>
                <th>Goal</th>
                <th>Target</th>
                <th>Progress</th>
                <th>Remaining</th>
                {isCurrentYear && daysRemaining > 0 && (
                  <th>Daily Pace Needed</th>
                )}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedGoals.map((goal) => {
                const progress = calculateProgress(goal.value);
                const remaining = Math.max(0, goal.value - currentDistance);
                const paceNeeded = calculateDailyPaceNeeded(goal.value);
                const status = getStatusText(goal.value);
                const statusColor = getStatusColor(goal.value);

                return (
                  <tr key={goal.id}>
                    <td><strong>{goal.label || 'Unnamed'}</strong></td>
                    <td>{goal.value.toLocaleString()} mi</td>
                    <td>
                      <div className="progress" style={{ height: '20px', minWidth: '100px' }}>
                        <div
                          className={`progress-bar bg-${statusColor}`}
                          role="progressbar"
                          style={{ width: `${Math.min(100, progress)}%` }}
                          aria-valuenow={progress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          {progress.toFixed(0)}%
                        </div>
                      </div>
                    </td>
                    <td>{remaining.toFixed(0)} mi</td>
                    {isCurrentYear && daysRemaining > 0 && (
                      <td>{paceNeeded.toFixed(1)} mi/day</td>
                    )}
                    <td>
                      <span className={`badge bg-${statusColor}`}>
                        {status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {isCurrentYear && daysRemaining > 0 && (
          <p className="text-muted mt-2 mb-0">
            <small>{daysRemaining} days remaining in {year}</small>
          </p>
        )}
        {!isCurrentYear && (
          <p className="text-muted mt-2 mb-0">
            <small>Historical year - pace calculations not applicable</small>
          </p>
        )}
      </div>
    </div>
  );
};

export default GoalSummaryTable;
