/**
 * A generated module for Flux functions
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
import { dag, Container, Secret, Directory, object, func } from "@dagger.io/dagger"
import { FluxFunctions } from "./flux_functions"

@object()
export class Flux {
  
  /**
   * Flux-spezifische Operationen
   */
  flux(): FluxFunctions {
    return new FluxFunctions()
  }

  // @func()
  // async pushArtifact(
  //   source: Directory,
  //   components: string[],
  //   gitUrl: string,
  //   gitlabUser: string,
  //   gitlabToken: Secret,
  //   gitRevision: string,
  //   version: string,
  //   tag: string = "latest",
  //   sign: boolean = false,
  // ): Promise<string> {
  //   return this.flux().pushArtifact(...)
  // }
}
