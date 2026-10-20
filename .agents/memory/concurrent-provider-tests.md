---
name: Concurrent provider tests
description: Avoid timing-dependent mock responses in concurrent provider API tests.
---

Match provider HTTP mocks by URL and method rather than assigning a sequence of one-shot responses to concurrent requests.

**Why:** Company, onboarding and funding lookups run concurrently. Asynchronous authorization/database lookups can reorder their arrival at the HTTP mock. Ordered responses intermittently feed a valid response to the wrong endpoint, producing a false provider-contract failure instead of testing the intended funding restriction.

**How to apply:** Override only the endpoint relevant to the scenario and delegate other requests to the normal mock. Assert the specific readiness error and absence of a submission request, not just a generic failure status. Keep production provider behavior unchanged when correcting a test-ordering issue.
