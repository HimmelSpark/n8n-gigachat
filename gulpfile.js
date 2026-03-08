const path = require('path');
const { task, src, dest, series } = require('gulp');

task('build:icons', copyIcons);
task('build:certs', copyCerts);
task('default', series('build:icons', 'build:certs'));

function copyIcons() {
  const nodeSource = path.resolve('nodes', '**', '*.{png,svg}');
  const nodeDestination = path.resolve('dist', 'nodes');

  src(nodeSource).pipe(dest(nodeDestination));

  const credSource = path.resolve('credentials', '**', '*.{png,svg}');
  const credDestination = path.resolve('dist', 'credentials');

  return src(credSource).pipe(dest(credDestination));
}

function copyCerts() {
  const certSource = path.resolve('nodes', 'shared', 'certs', '*.pem');
  const certDestination = path.resolve('dist', 'nodes', 'shared', 'certs');

  return src(certSource).pipe(dest(certDestination));
}
