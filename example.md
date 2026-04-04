# Usage Examples

# Single-Modus (d2-fleet-homelab)

```bash
dagger call push-artifact \
--source=. \
--registry=registry.gitlab.com/user/fleet \
--gitlab-user=myuser \
--gitlab-token=env:GITLAB_TOKEN \
--git-url=https://gitlab.com/user/fleet \
--git-revision=abc123 \
--version=1.0.0
```

# Multi-Modus (d2-infra-homelab)

```bash
dagger call push-artifact \
--source=. \
--registry=registry.gitlab.com/user/infra \
--gitlab-user=myuser \
--gitlab-token=env:GITLAB_TOKEN \
--git-url=https://gitlab.com/user/infra \
--git-revision=abc123 \
--version=1.0.0 \
--components=cert-manager \
--components=ingress-nginx
```
