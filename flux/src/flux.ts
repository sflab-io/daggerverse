import { dag, Container, Directory, Secret, object, func } from "@dagger.io/dagger"

const FLUX_IMAGE = "ghcr.io/fluxcd/flux-cli:v2.8.3"
const COSIGN_VERSION = "v2.6.1"

@object()
export class Flux {

  /**
   * Pusht OCI-Artefakte in eine Registry und signiert sie optional mit Cosign.
   *
   * Im Single-Modus (components leer) wird das gesamte source-Verzeichnis als
   * ein einziges OCI-Artefakt unter registry:version gepusht.
   *
   * Im Multi-Modus (components angegeben) wird jede Komponente aus dem
   * Unterverzeichnis components/<name> als separates OCI-Artefakt unter
   * registry/<name>:version gepusht.
   *
   * @param source - Quellverzeichnis
   * @param registry - OCI-Registry-URL ohne Prefix, z.B. "registry.gitlab.com/user/repo"
   * @param gitlabUser - GitLab-Benutzername für Registry-Authentifizierung
   * @param gitlabToken - GitLab-Token für Registry-Authentifizierung
   * @param gitUrl - Git-URL der Quelle (für Artifact-Metadaten)
   * @param gitRevision - Git-Revision (für Artifact-Metadaten)
   * @param version - Version-Tag des Artefakts, z.B. "1.0.0" oder ein Git-SHA
   * @param tag - Mutabler Tag, der nach dem Push gesetzt wird (Standard: "latest")
   * @param components - Komponentennamen unterhalb von components/ (Multi-Modus wenn angegeben)
   * @param sign - Cosign-Signierung aktivieren (Standard: true)
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
