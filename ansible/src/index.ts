/**
 * A generated module for Ansible functions
 *
 * This module has been generated via dagger init and serves as a reference to
 * basic module structure as you get started with Dagger.
 *
 * Two functions have been pre-created. You can modify, delete, or add to them,
 * as needed. They demonstrate usage of arguments and return types using simple
 * echo and grep commands. The functions can be called from the dagger CLI or
 * from one of the SDKs.
 *
 * The first line in this comment block is a short description line and the
 * rest is a long description with more detail on the module's purpose or usage,
 * if appropriate. All modules should have a short description.
 */
import { dag, Container, Directory, object, func } from "@dagger.io/dagger"

@object()
export class Ansible {
  
  /**
   * Install Ansible Galaxy collections from a requirements file.
   */
  @func()
  async galaxyInstall(directory: Directory, requirementsFile: string): Promise<Container> {
    return dag
      .container()
      .from("alpine/ansible:latest")
      .withExec(["apk", "add", "--no-cache", "git"])
      .withMountedDirectory("/work", directory)
      .withWorkdir("/work")
      .withExec(["ansible-galaxy", "collection", "install", "-r", requirementsFile])
      .withExec(["ansible-galaxy", "role", "install", "-r", requirementsFile])
  }
}
