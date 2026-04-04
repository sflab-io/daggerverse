import { dag, Service, Container, File, Directory, Secret, object, func } from "@dagger.io/dagger"

const FLUX_IMAGE = "ghcr.io/fluxcd/flux-cli:v2.8.3"
const COSIGN_VERSION = "v2.6.1"

@object()
export class Flux {

  /**
   * Bootstraps the Flux Operator on an existing Kubernetes cluster.
   *
   * Step 1: Checks prerequisites with `flux check --pre`
   * Step 2: Installs the Flux Operator via Helm
   * Step 3: Creates the GitLab pull secret (flux-system)
   * Step 4: Creates the SOPS AGE secret (flux-sops)
   * Step 5 (optional): Applies cluster manifests (runtime-info.yaml + flux-instance.yaml)
   * Step 6 (optional): Waits for the FluxInstance to be ready (with diagnostic output on failure)
   *
   * @param kubeconfig - Kubeconfig file of the target cluster
   * @param gitlabUser - GitLab username (e.g. abes140377)
   * @param gitlabToken - GitLab Personal Access Token (as a Dagger Secret)
   * @param sopsAgeKey - AGE key for SOPS decryption (as a Dagger Secret)
   * @param k3SService - Optional k3s service binding for internal cluster access
   * @param clusterDir - Optional directory containing cluster manifests (enables steps 5+6)
   * @param timeout - Timeout for waiting for FluxInstance readiness (default: 2m)
   */
  @func()
  async bootstrap(kubeconfig: File, gitlabUser: string, gitlabToken: Secret, sopsAgeKey: Secret, k3SService?: Service, clusterDir?: Directory, timeout: string = "2m"): Promise<string> {
    const kubeconfigPath = "/tmp/kubeconfig"
    const fluxImage = "ghcr.io/fluxcd/flux-cli:v2.8.3"
    const helmImage = "dtzar/helm-kubectl:3.17"

    // Step 1: flux check --pre
    let fluxCheckContainer = dag
      .container()
      .from(fluxImage)
      .withFile(kubeconfigPath, kubeconfig, { permissions: 0o644 })
      .withEnvVariable("KUBECONFIG", kubeconfigPath)

    if (k3SService) {
      fluxCheckContainer = fluxCheckContainer.withServiceBinding("kubernetes", k3SService)
    }

    const fluxCheckOutput = await fluxCheckContainer
      .withExec(["flux", "check", "--pre"])
      .stdout()

    // Step 2: Install the Flux Operator via Helm
    let helmContainer = dag
      .container()
      .from(helmImage)
      .withFile(kubeconfigPath, kubeconfig, { permissions: 0o644 })
      .withEnvVariable("KUBECONFIG", kubeconfigPath)

    if (k3SService) {
      helmContainer = helmContainer.withServiceBinding("kubernetes", k3SService)
    }

    const helmOutput = await helmContainer
      .withExec([
        "helm", "upgrade", "--install", "flux-operator",
        "oci://ghcr.io/controlplaneio-fluxcd/charts/flux-operator",
        "--namespace", "flux-system",
        "--create-namespace",
        "--set", "multitenancy.enabled=true",
        "--wait",
      ])
      .stdout()

    // Step 3b: Create GitHub Container Registry pull secret for Flux Operator images
    let glcrSecretContainer = dag
      .container()
      .from(helmImage)
      .withFile(kubeconfigPath, kubeconfig, { permissions: 0o644 })
      .withEnvVariable("KUBECONFIG", kubeconfigPath)
      .withEnvVariable("CACHE_BUST", new Date().toISOString())
      .withSecretVariable("GITLAB_TOKEN", gitlabToken)

    if (k3SService) {
      glcrSecretContainer = glcrSecretContainer.withServiceBinding("kubernetes", k3SService)
    }

    const glcrSecretOutput = await glcrSecretContainer
      .withExec([
      "sh", "-c",
      `kubectl -n flux-system create secret docker-registry glcr-auth` +
      ` --docker-server=registry.gitlab.com` +
      ` --docker-username=${gitlabUser}` +
      ` --docker-password=$GITLAB_TOKEN` +
      ` --dry-run=client -o yaml | kubectl apply -f -`,
      ])
      .stdout()

    // Step 4: Create SOPS AGE secret
    let sopsSecretContainer = dag
      .container()
      .from(helmImage)
      .withFile(kubeconfigPath, kubeconfig, { permissions: 0o644 })
      .withEnvVariable("KUBECONFIG", kubeconfigPath)
      .withEnvVariable("CACHE_BUST", new Date().toISOString())
      .withSecretVariable("SOPS_AGE_KEY", sopsAgeKey)

    if (k3SService) {
      sopsSecretContainer = sopsSecretContainer.withServiceBinding("kubernetes", k3SService)
    }

    const sopsSecretOutput = await sopsSecretContainer
      .withExec([
        "sh", "-c",
        `kubectl create secret generic flux-sops` +
        ` --namespace=flux-system` +
        ` --from-literal=age.agekey="$SOPS_AGE_KEY"` +
        ` --dry-run=client -o yaml | kubectl apply -f -`,
      ])
      .stdout()

    const parts = [
      "=== flux check --pre ===",
      fluxCheckOutput,
      "=== helm install flux-operator ===",
      helmOutput,
      "=== flux create secret git flux-system ===",
      glcrSecretOutput,
      "=== kubectl apply flux-sops ===",
      sopsSecretOutput,
    ]

    if (clusterDir) {
      const kubeconfigPath = "/tmp/kubeconfig"
      const helmImage = "dtzar/helm-kubectl:3.17"

      // Step 5: Apply FluxInstance manifests
      let applyContainer = dag
        .container()
        .from(helmImage)
        .withFile(kubeconfigPath, kubeconfig, { permissions: 0o644 })
        .withEnvVariable("KUBECONFIG", kubeconfigPath)
        .withEnvVariable("CACHE_BUST", new Date().toISOString())
        .withDirectory("/manifests", clusterDir)

      if (k3SService) {
        applyContainer = applyContainer.withServiceBinding("kubernetes", k3SService)
      }

      const applyOutput = await applyContainer
        // Manually applying runtime-info.yaml before flux-instance.yaml prevents initial reconciliation errors in
        // tenant Kustomizations. It is not a technical requirement, but a useful bootstrap optimization that keeps the first sync clean.
        .withExec(["kubectl", "apply", "-f", "/manifests/flux-system/runtime-info.yaml"])
        .withExec(["kubectl", "apply", "-f", "/manifests/flux-system/flux-instance.yaml"])
        .stdout()

      // Step 6: Wait for FluxInstance to be ready (with diagnostic output on failure)
      let waitContainer = dag
        .container()
        .from(helmImage)
        .withFile(kubeconfigPath, kubeconfig, { permissions: 0o644 })
        .withEnvVariable("KUBECONFIG", kubeconfigPath)
        .withEnvVariable("CACHE_BUST", new Date().toISOString())

      if (k3SService) {
        waitContainer = waitContainer.withServiceBinding("kubernetes", k3SService)
      }

      const waitOutput = await waitContainer
        .withExec([
          "sh", "-c",
          `if kubectl -n flux-system wait fluxinstance/flux --for=condition=ready --timeout=${timeout}; then
  kubectl -n flux-system get fluxinstance/flux
  kubectl -n flux-system get pods
else
  echo "ERROR: FluxInstance 'flux' wurde nicht innerhalb von ${timeout} bereit" >&2
  kubectl -n flux-system describe fluxinstance/flux >&2
  kubectl -n flux-system get pods -o wide >&2
  kubectl -n flux-system get events --sort-by='.lastTimestamp' >&2
  exit 1
fi`,
        ])
        .stdout()

      parts.push("=== apply FluxInstance ===", applyOutput)
      parts.push("=== wait FluxInstance ready ===", waitOutput)
    }

    return parts.join("\n")
  }

  /**
   * Pushes OCI artifacts to a registry and optionally signs them with Cosign.
   *
   * In single mode (components empty) the entire source directory is pushed as
   * a single OCI artifact under registry:version.
   *
   * In multi mode (components provided) each component from the subdirectory
   * components/<name> is pushed as a separate OCI artifact under
   * registry/<name>:version.
   *
   * @param source - Source directory
   * @param registry - OCI registry URL without prefix, e.g. "registry.gitlab.com/user/repo"
   * @param gitlabUser - GitLab username for registry authentication
   * @param gitlabToken - GitLab token for registry authentication
   * @param gitUrl - Git URL of the source (for artifact metadata)
   * @param gitRevision - Git revision (for artifact metadata)
   * @param version - Version tag of the artifact, e.g. "1.0.0" or a Git SHA
   * @param tag - Mutable tag set after the push (default: "latest")
   * @param components - Component names below components/ (multi mode when provided)
   * @param sign - Enable Cosign signing (default: true)
   */
  @func()
  async pushArtifact(
    source: Directory,
    registry: string,
    gitlabUser: string,
    gitlabToken: Secret,
    gitUrl: string,
    gitRevision: string,
    version: string,
    tag: string = "latest",
    components: string[] = [],
    sign: boolean = true,
  ): Promise<string> {
    const fluxBase = dag
      .container()
      .from(FLUX_IMAGE)
      .withUser("root")
      .withDirectory("/workspace", source)
      .withWorkdir("/workspace")
      .withSecretVariable("GITLAB_TOKEN", gitlabToken)

    if (components.length > 0) {
      return this.pushComponents(fluxBase, registry, gitlabUser, gitlabToken, gitRevision, gitUrl, version, tag, components, sign)
    }

    return this.pushSingle(fluxBase, registry, gitlabUser, gitlabToken, gitRevision, gitUrl, version, tag, sign)
  }

  private async pushSingle(
    fluxBase: Container,
    registry: string,
    gitlabUser: string,
    gitlabToken: Secret,
    gitRevision: string,
    gitUrl: string,
    version: string,
    tag: string,
    sign: boolean,
  ): Promise<string> {
    const artifactUrl = `oci://${registry}:${version}`

    const pushOutput = await fluxBase
      .withExec([
        "sh", "-c",
        `flux push artifact ${artifactUrl}` +
        ` --path=.` +
        ` --source=${gitUrl}` +
        ` --revision=${gitRevision}` +
        ` --creds=${gitlabUser}:$GITLAB_TOKEN` +
        ` --output=json`,
      ])
      .stdout()

    const tagOutput = await fluxBase
      .withExec([
        "sh", "-c",
        `flux tag artifact ${artifactUrl}` +
        ` --tag=${tag}` +
        ` --creds=${gitlabUser}:$GITLAB_TOKEN`,
      ])
      .stdout()

    const parts = [
      "=== flux push artifact ===",
      pushOutput,
      "=== flux tag artifact ===",
      tagOutput,
    ]

    if (sign && pushOutput.trim()) {
      const signOutput = await this.cosignArtifact(registry, gitlabUser, gitlabToken, pushOutput)
      parts.push("=== cosign sign ===", signOutput)
    }

    return parts.join("\n")
  }

  private async pushComponents(
    fluxBase: Container,
    registry: string,
    gitlabUser: string,
    gitlabToken: Secret,
    gitRevision: string,
    gitUrl: string,
    version: string,
    tag: string,
    components: string[],
    sign: boolean,
  ): Promise<string> {
    const parts: string[] = []

    for (const component of components) {
      const artifactUrl = `oci://${registry}/${component}:${version}`

      const pushOutput = await fluxBase
        .withExec([
          "sh", "-c",
          `flux push artifact ${artifactUrl}` +
          ` --path=./components/${component}` +
          ` --source=${gitUrl}` +
          ` --revision=${gitRevision}` +
          ` --creds=${gitlabUser}:$GITLAB_TOKEN` +
          ` --output=json`,
        ])
        .stdout()

      parts.push(`=== flux push artifact: ${component} ===`, pushOutput)

      const tagOutput = await fluxBase
        .withExec([
          "sh", "-c",
          `flux tag artifact ${artifactUrl}` +
          ` --tag=${tag}` +
          ` --creds=${gitlabUser}:$GITLAB_TOKEN`,
        ])
        .stdout()

      parts.push(`=== flux tag artifact: ${component} ===`, tagOutput)

      if (sign && pushOutput.trim()) {
        const signOutput = await this.cosignArtifact(`${registry}/${component}`, gitlabUser, gitlabToken, pushOutput)
        parts.push(`=== cosign sign: ${component} ===`, signOutput)
      }
    }

    return parts.join("\n")
  }

  /**
   * Statische Validierung eines Repositories: YAML-Linting + Manifest-Schema-Validierung.
   *
   * Schritt 1: yamllint — YAML-Syntax-Validierung aller Manifests
   * Schritt 2: kubeconform — Schema-Validierung der Manifests in rawDirs
   * Schritt 3: kustomize build | kubeconform — Schema-Validierung aller kustomization.yaml in kustomizeDirs
   *
   * Nutzt `.yamllint.yaml` aus dem Repository.
   *
   * @param source - Repository-Verzeichnis (z.B. --source=.)
   * @param rawDirs - Verzeichnisse für direkte kubeconform-Validierung (default: ["clusters/"])
   * @param kustomizeDirs - Verzeichnisse für kustomize build + kubeconform (default: ["tenants/"])
   * @param excludeFilePatterns - Regex-Muster für Dateinamen, die kubeconform überspringen soll (z.B. ["kustomizeconfig.yaml"])
   */
  @func()
  async validate(
    source: Directory,
    rawDirs: string[] = ["clusters/"],
    kustomizeDirs: string[] = ["tenants/"],
    excludeFilePatterns: string[] = [],
  ): Promise<string> {
    const workdir = "/src"

    const base: Container = await dag
      .container()
      .from("alpine:3.20")
      .withExec(["apk", "add", "--no-cache", "python3", "py3-pip", "curl", "bash"])
      .withExec(["pip3", "install", "--break-system-packages", "yamllint"])
      .withExec([
        "sh", "-c",
        `curl -sL "https://github.com/yannh/kubeconform/releases/download/v0.7.0/kubeconform-linux-amd64.tar.gz" \
          | tar -xz -C /usr/local/bin kubeconform`,
      ])
      .withExec([
        "sh", "-c",
        `curl -sL "https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2Fv5.4.3/kustomize_v5.4.3_linux_amd64.tar.gz" \
          | tar -xz -C /usr/local/bin kustomize`,
      ])
      .sync()

    const container = base
      .withDirectory(workdir, source)
      .withWorkdir(workdir)

    const yamllintOutput = await container
      .withExec(["yamllint", "-c", ".yamllint.yaml", "."])
      .stdout()

    const kubeconformFlags = [
      "-kubernetes-version", "1.32.0",
      "-schema-location", "default",
      "-schema-location", "https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json",
      "-ignore-missing-schemas",
      ...excludeFilePatterns.map(p => `-ignore-filename-pattern ${p}`),
    ].join(" ")

    const rawValidation = rawDirs
      .map(dir => `echo "==> Validating raw manifests in ${dir}..."\nkubeconform ${kubeconformFlags} ${dir} || EXIT_CODE=1`)
      .join("\n\n")

    const kustomizeValidation = kustomizeDirs
      .map(dir =>
        `echo ""\necho "==> Validating kustomize builds in ${dir}..."\n` +
        `while IFS= read -r f; do\n` +
        `  kdir=$(dirname "$f")\n` +
        `  echo "  --> Building: $kdir"\n` +
        `  kustomize build "$kdir" | kubeconform ${kubeconformFlags} - || EXIT_CODE=1\n` +
        `done < <(find ${dir} -name "kustomization.yaml" -o -name "kustomization.yml")`
      )
      .join("\n\n")

    const manifestOutput = await container
      .withExec([
        "sh", "-c",
        `EXIT_CODE=0\n\n${rawValidation}\n\n${kustomizeValidation}\n\nexit $EXIT_CODE`,
      ])
      .stdout()

    return [
      "=== Step 1: YAML Linting ===",
      yamllintOutput.trim() || "No issues found",
      "",
      "=== Step 2+3: Manifest Schema Validation ===",
      manifestOutput,
    ].join("\n")
  }

  private async cosignArtifact(
    registry: string,
    gitlabUser: string,
    gitlabToken: Secret,
    pushOutput: string,
  ): Promise<string> {
    let digestUrl: string
    try {
      const parsed = JSON.parse(pushOutput)
      digestUrl = `${registry}@${parsed.digest}`
    } catch {
      return "Skipped: could not parse digest from push output"
    }

    return dag
      .container()
      .from("alpine:3.20")
      .withExec(["apk", "add", "--no-cache", "curl"])
      .withExec([
        "sh", "-c",
        `curl -sL "https://github.com/sigstore/cosign/releases/download/${COSIGN_VERSION}/cosign-linux-amd64"` +
        ` -o /usr/local/bin/cosign && chmod +x /usr/local/bin/cosign`,
      ])
      .withSecretVariable("GITLAB_TOKEN", gitlabToken)
      .withExec([
        "sh", "-c",
        `cosign login registry.gitlab.com -u ${gitlabUser} -p $GITLAB_TOKEN` +
        ` && cosign sign --yes ${digestUrl}`,
      ])
      .stdout()
  }
}
