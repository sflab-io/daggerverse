/**
 * A Dagger module for running Terragrunt commands in a containerized environment.
 *
 * Provides a single flexible `run` function that executes any terragrunt command
 * in the configured container with SSH agent forwarding and environment variable support.
 *
 * Example usage:
 *   dagger call run --source=. --stack-dir=staging/my-stack --ssh-socket=/run/user/1000/ssh-agent.socket --command="stack run plan"
 *   dagger call run --source=. --stack-dir=staging/my-stack --ssh-socket=/run/user/1000/ssh-agent.socket --command="stack run apply --non-interactive"
 */
import { dag, Container, Directory, Socket, ReturnType, object, func } from "@dagger.io/dagger"

@object()
export class Terragrunt {

  /**
   * Runs an arbitrary terragrunt command in the given directory.
   *
   * @param source - The repository root directory to mount into the container
   * @param stackDir - Relative path to the working directory (e.g. "staging/proxmox-k3s-vms")
   * @param sshSocket - SSH agent socket for git authentication
   * @param command - The terragrunt command to run (e.g. "stack run plan", "stack run apply --non-interactive")
   * @param envVars - Environment variables as KEY=VALUE strings (e.g. "AWS_ACCESS_KEY_ID=abc")
   */
  @func()
  async run(
    source: Directory,
    stackDir: string,
    sshSocket: Socket,
    command: string,
    envVars: string[] = [],
  ): Promise<string> {
    const ctr = this.terragruntContainer(source, stackDir, sshSocket, envVars)
      .withExec(["sh", "-c", `terragrunt ${command} 2>&1`], { expect: ReturnType.Any })
    return (await ctr.stdout()) + (await ctr.stderr())
  }

  /**
   * Helper function to create a container with the Terragrunt image and common configuration.
   * This function is used by all the stack* functions to avoid code duplication.
   *
   * @param source - The repository root directory to mount into the container
   * @param stackDir - Relative path to the stack directory (e.g. "staging/proxmox-k3s-vms")
   * @param sshSocket - SSH agent socket for git authentication (e.g. unix:///run/user/1000/ssh-agent.socket)
   * @param envVars - Environment variables as KEY=VALUE strings (e.g. "AWS_ACCESS_KEY_ID=abc")
   * @returns A Container instance with the Terragrunt image and configuration
   */
  private terragruntContainer(
    source: Directory,
    stackDir: string,
    sshSocket: Socket,
    envVars: string[],
  ): Container {
    let ctr = dag
      .container()
      .from("devopsinfra/docker-terragrunt:ot-1.11.5-tg-0.99.5")
      .withMountedDirectory("/repo", source)
      .withWorkdir(`/repo/${stackDir}`)
      .withEnvVariable("SSH_AUTH_SOCK", "/ssh-agent.sock")
      .withEnvVariable("GIT_SSH_COMMAND", "ssh -o StrictHostKeyChecking=no")
      .withEnvVariable("TF_IN_AUTOMATION", "1")
      .withEnvVariable("CHECKPOINT_DISABLE", "1")
      .withUnixSocket("/ssh-agent.sock", sshSocket)

    for (const envVar of envVars) {
      const idx = envVar.indexOf("=")
      if (idx === -1) continue
      const name = envVar.substring(0, idx)
      const value = envVar.substring(idx + 1)
      ctr = ctr.withEnvVariable(name, value)
    }

    return ctr
  }
}
