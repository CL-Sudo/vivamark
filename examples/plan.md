# Request Certificate screen: plan

A Setup screen where a Director or Attestor enrols their own certificate.
Nothing is written to the database.

## Phases

1. Enrolment class and unit tests, autoload refresh.
2. Applet scaffold, save handler and container page.
3. Deploy and rollback SQL, browser verification.

## Rollout

| Stage          | Owner         | Status  |
|----------------|---------------|---------|
| Shadow traffic | Platform team | Ready   |
| Canary         | Payments team | Blocked |

## Risks

The save handler touches the certificate store; a failed enrolment must leave
no partial rows.
