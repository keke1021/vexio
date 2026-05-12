const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

bcrypt.hash('admin1234', 12).then(async function(hash) {
  await prisma.user.updateMany({ data: { password: hash } })
  console.log('Listo')
  process.exit(0)
})