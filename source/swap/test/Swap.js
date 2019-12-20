const Swap = artifacts.require('Swap')
const Types = artifacts.require('Types')
const FungibleToken = artifacts.require('FungibleToken')
const TransferHandlerRegistry = artifacts.require('TransferHandlerRegistry')
const ERC20TransferHandler = artifacts.require('ERC20TransferHandler')
const {
  emitted,
  reverted,
  notEmitted,
  ok,
  equal,
} = require('@airswap/test-utils').assert
const { allowances, balances } = require('@airswap/test-utils').balances
const {
  getLatestTimestamp,
  getTimestampPlusDays,
  advanceTime,
} = require('@airswap/test-utils').time
const { orders, signatures } = require('@airswap/order-utils')
const {
  ERC20_INTERFACE_ID,
  SECONDS_IN_DAY,
  GANACHE_PROVIDER,
  EMPTY_ADDRESS,
} = require('@airswap/order-utils').constants

contract('Swap', async accounts => {
  const aliceAddress = accounts[0]
  const bobAddress = accounts[1]
  const carolAddress = accounts[2]
  const davidAddress = accounts[3]
  const UNKNOWN_KIND = '0xffffffff'
  let swapContract
  let swapAddress
  let tokenAST
  let tokenDAI
  let transferHandlerRegistry

  let swap
  let cancel
  let cancelUpTo

  describe('Deploying...', async () => {
    it('Deployed Swap contract', async () => {
      transferHandlerRegistry = await TransferHandlerRegistry.new()
      const typesLib = await Types.new()
      await Swap.link('Types', typesLib.address)
      swapContract = await Swap.new(transferHandlerRegistry.address)
      swapAddress = swapContract.address

      swap = swapContract.swap
      cancel = swapContract.methods['cancel(uint256[])']
      cancelUpTo = swapContract.methods['cancelUpTo(uint256)']

      orders.setVerifyingContract(swapAddress)
    })

    it('Deployed test contract "AST"', async () => {
      tokenAST = await FungibleToken.new()
    })

    it('Deployed test contract "DAI"', async () => {
      tokenDAI = await FungibleToken.new()
    })

    it('Check that TransferHandlerRegistry correctly set', async () => {
      equal(await swapContract.registry.call(), transferHandlerRegistry.address)
    })

    it('Set up TokenRegistry', async () => {
      const erc20TransferHandler = await ERC20TransferHandler.new()

      await transferHandlerRegistry.addTransferHandler(
        ERC20_INTERFACE_ID,
        erc20TransferHandler.address
      )
    })
  })

  describe('Minting ERC20 tokens (AST, DAI, and OMG)...', async () => {
    it('Mints 1000 AST for Alice', async () => {
      emitted(await tokenAST.mint(aliceAddress, 1000), 'Transfer')
      ok(
        await balances(aliceAddress, [
          [tokenAST, 1000],
          [tokenDAI, 0],
        ]),
        'Alice balances are incorrect'
      )
    })

    it('Mints 1000 DAI for Bob', async () => {
      emitted(await tokenDAI.mint(bobAddress, 1000), 'Transfer')
      ok(
        await balances(bobAddress, [
          [tokenAST, 0],
          [tokenDAI, 1000],
        ]),
        'Bob balances are incorrect'
      )
    })
  })

  describe('Approving ERC20 tokens (AST and DAI)...', async () => {
    it('Checks approvals (Alice 250 AST and 0 DAI, Bob 0 AST and 500 DAI)', async () => {
      emitted(
        await tokenAST.approve(swapAddress, 250, { from: aliceAddress }),
        'Approval'
      )
      emitted(
        await tokenDAI.approve(swapAddress, 1000, { from: bobAddress }),
        'Approval'
      )
      ok(
        await allowances(aliceAddress, swapAddress, [
          [tokenAST, 250],
          [tokenDAI, 0],
        ])
      )
      ok(
        await allowances(bobAddress, swapAddress, [
          [tokenAST, 0],
          [tokenDAI, 1000],
        ])
      )
    })
  })

  describe('Swaps (Fungible)', async () => {
    let _order

    before('Alice creates an order for Bob (200 AST for 50 DAI)', async () => {
      _order = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
          token: tokenAST.address,
          amount: 200,
        },
        sender: {
          wallet: bobAddress,
          token: tokenDAI.address,
          amount: 50,
        },
      })

      _order.signature = await signatures.getWeb3Signature(
        _order,
        aliceAddress,
        swapAddress,
        GANACHE_PROVIDER
      )
    })

    it('Checks that Alice cannot swap more than balance approved (2000 AST for 50 DAI)', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
          token: tokenAST.address,
          amount: 2000,
        },
        sender: {
          wallet: bobAddress,
          token: tokenDAI.address,
          amount: 50,
        },
      })

      order.signature = await signatures.getWeb3Signature(
        order,
        aliceAddress,
        swapAddress,
        GANACHE_PROVIDER
      )
      await reverted(swap(order, { from: bobAddress }), 'TRANSFER_FAILED')
    })

    it('Checks that Bob can swap with Alice (200 AST for 50 DAI)', async () => {
      emitted(await swap(_order, { from: bobAddress }), 'Swap')
    })
    it('Checks that Alice cannot swap with herself (200 AST for 50 AST)', async () => {
      const selfOrder = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
          token: tokenAST.address,
          amount: 200,
        },
        sender: {
          wallet: aliceAddress,
          token: tokenAST.address,
          amount: 50,
        },
      })
      await reverted(
        swap(selfOrder, { from: aliceAddress }),
        'INVALID_SELF_TRANSFER'
      )
    })

    it('Alice sends Bob with an unknown kind for 1 DAI', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
          token: tokenAST.address,
          amount: 1,
          kind: UNKNOWN_KIND,
        },
        sender: {
          wallet: bobAddress,
          token: tokenDAI.address,
          amount: 10,
        },
      })

      order.signature = await signatures.getWeb3Signature(
        order,
        aliceAddress,
        swapAddress,
        GANACHE_PROVIDER
      )

      await reverted(
        swap(order, { from: bobAddress }),
        'UNKNOWN_TRANSFER_HANDLER'
      )
    })

    it('Checks balances...', async () => {
      ok(
        await balances(aliceAddress, [
          [tokenAST, 800],
          [tokenDAI, 50],
        ]),
        'Alice balances are incorrect'
      )
      ok(
        await balances(bobAddress, [
          [tokenAST, 200],
          [tokenDAI, 950],
        ]),
        'Bob balances are incorrect'
      )
    })
    it('Checks that Bob cannot take the same order again (200 AST for 50 DAI)', async () => {
      await reverted(
        swap(_order, { from: bobAddress }),
        'ORDER_TAKEN_OR_CANCELLED'
      )
    })

    it('Checks balances...', async () => {
      ok(
        await balances(aliceAddress, [
          [tokenAST, 800],
          [tokenDAI, 50],
        ]),
        'Alice balances are incorrect'
      )
      ok(
        await balances(bobAddress, [
          [tokenAST, 200],
          [tokenDAI, 950],
        ]),
        'Bob balances are incorrect'
      )
    })

    it('Checks that Alice cannot trade more than approved (200 AST)', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
          token: tokenAST.address,
          amount: 200,
        },
      })

      await reverted(swap(order, { from: bobAddress }))
    })

    it('Checks that Bob cannot take an expired order', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
        },
        sender: {
          wallet: bobAddress,
        },
        expiry: (await getLatestTimestamp()) - 10,
      })
      await reverted(swap(order, { from: bobAddress }), 'ORDER_EXPIRED')
    })

    it('Checks that an order is expired when expiry == block.timestamp', async () => {
      // with this method, sometimes order.expiry is 1 second before block.timestamp
      // however ~50% of the time they are equal. This is due to the fact that in the
      // time it takes to create an order, some number of milliseconds pass. Sometimes
      // that pushes the current time into the next second, and sometimes it doesnt.
      // Therefore sometimes the current time is the same time as the expiry, and sometimes
      // the current time is one second after the expiry
      const ONE_DAY = SECONDS_IN_DAY * 1
      const order = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
        },
        sender: {
          wallet: bobAddress,
        },
        expiry: await getTimestampPlusDays(1),
      })

      await advanceTime(ONE_DAY)
      await reverted(swap(order, { from: bobAddress }), 'ORDER_EXPIRED')
    })
    it('Checks that Bob can not trade more than he holds', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: bobAddress,
          token: tokenDAI.address,
          amount: 1000,
        },
        sender: {
          wallet: aliceAddress,
        },
      })
      await reverted(swap(order, { from: aliceAddress }))
    })

    it('Checks remaining balances and approvals', async () => {
      ok(
        await balances(aliceAddress, [
          [tokenAST, 800],
          [tokenDAI, 50],
        ]),
        'Alice balances are incorrect'
      )
      ok(
        await balances(bobAddress, [
          [tokenAST, 200],
          [tokenDAI, 950],
        ]),
        'Bob balances are incorrect'
      )
      // Alice and Bob swapped 200 AST for 50 DAI above, thereforeL
      // Alice's 200 AST approval is now all gone
      // Bob's 1000 DAI approval has decreased by 50
      ok(
        await allowances(aliceAddress, swapAddress, [
          [tokenAST, 50],
          [tokenDAI, 0],
        ])
      )
      ok(
        await allowances(bobAddress, swapAddress, [
          [tokenAST, 0],
          [tokenDAI, 950],
        ])
      )
    })

    it('Checks that adding an affiliate address still swaps', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
          token: tokenAST.address,
          amount: 1,
        },
        sender: {
          wallet: bobAddress,
          token: tokenDAI.address,
          amount: 1,
        },
        affiliate: {
          wallet: carolAddress,
          token: EMPTY_ADDRESS,
          amount: 0,
        },
      })

      order.signature = await signatures.getWeb3Signature(
        order,
        aliceAddress,
        swapAddress,
        GANACHE_PROVIDER
      )

      emitted(await swap(order, { from: bobAddress }), 'Swap')
    })

    it('Transfers tokens back for future tests', async () => {
      // now transfer the tokens back to leave balances unchanged for future tests
      await tokenDAI.transfer(bobAddress, 1, { from: aliceAddress })
      await tokenAST.transfer(aliceAddress, 1, { from: bobAddress })

      // previous balances unchanged
      ok(
        await balances(aliceAddress, [
          [tokenAST, 800],
          [tokenDAI, 50],
        ]),
        'Alice balances are incorrect'
      )
      ok(
        await balances(bobAddress, [
          [tokenAST, 200],
          [tokenDAI, 950],
        ]),
        'Bob balances are incorrect'
      )

      // increase allowances again
      await tokenAST.approve(swapAddress, 50, { from: aliceAddress })
      await tokenDAI.approve(swapAddress, 950, { from: bobAddress })

      ok(
        await allowances(aliceAddress, swapAddress, [
          [tokenAST, 50],
          [tokenDAI, 0],
        ])
      )
      ok(
        await allowances(bobAddress, swapAddress, [
          [tokenAST, 0],
          [tokenDAI, 950],
        ])
      )
    })
  })

  describe('Signer Delegation (Signer-side)', async () => {
    let _order
    let _unsignedOrder

    before('Alice creates an order for Bob (200 AST for 50 DAI)', async () => {
      _unsignedOrder = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
          token: tokenAST.address,
          amount: 50,
        },
        sender: {
          wallet: bobAddress,
          token: tokenDAI.address,
          amount: 10,
        },
      })

      _order = _unsignedOrder
      _order.signature = await signatures.getWeb3Signature(
        _order,
        davidAddress,
        swapAddress,
        GANACHE_PROVIDER
      )
    })

    it('Checks that David cannot make an order on behalf of Alice', async () => {
      await reverted(swap(_order, { from: bobAddress }), 'SIGNER_UNAUTHORIZED')
    })

    it('Checks that David cannot make an order on behalf of Alice without signature', async () => {
      await reverted(
        swap(_unsignedOrder, { from: bobAddress }),
        'SIGNER_UNAUTHORIZED'
      )
    })

    it('Alice attempts to incorrectly authorize herself to make orders', async () => {
      await reverted(
        swapContract.authorizeSigner(aliceAddress, {
          from: aliceAddress,
        }),
        'INVALID_AUTH_SIGNER'
      )
    })

    it('Alice authorizes David to make orders on her behalf', async () => {
      emitted(
        await swapContract.authorizeSigner(davidAddress, {
          from: aliceAddress,
        }),
        'AuthorizeSigner'
      )
    })

    it('Alice authorizes David a second time does not emit an event', async () => {
      notEmitted(
        await swapContract.authorizeSigner(davidAddress, {
          from: aliceAddress,
        }),
        'AuthorizeSigner'
      )
    })

    it('Alice approves Swap to spend the rest of her AST', async () => {
      emitted(
        await tokenAST.approve(swapAddress, 800, { from: aliceAddress }),
        'Approval'
      )
    })

    it('Checks that David can make an order on behalf of Alice', async () => {
      emitted(await swap(_order, { from: bobAddress }), 'Swap')
    })

    it('Alice revokes authorization from David', async () => {
      emitted(
        await swapContract.revokeSigner(davidAddress, { from: aliceAddress }),
        'RevokeSigner'
      )
    })

    it('Alice fails to try to revokes authorization from David again', async () => {
      notEmitted(
        await swapContract.revokeSigner(davidAddress, { from: aliceAddress }),
        'RevokeSigner'
      )
    })

    it('Checks that David can no longer make orders on behalf of Alice', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
        },
        sender: {
          wallet: bobAddress,
        },
      })

      order.signature = await signatures.getWeb3Signature(
        order,
        davidAddress,
        swapAddress,
        GANACHE_PROVIDER
      )

      await reverted(swap(order, { from: bobAddress }), 'SIGNER_UNAUTHORIZED')
    })
    it('Checks remaining balances and approvals', async () => {
      // Alice and Bob swapped 50 AST for 10 DAI. Previous balances were:
      // Alice 800 AST 50 DAI, Bob 200 AST 950 DAI
      ok(
        await balances(aliceAddress, [
          [tokenAST, 750],
          [tokenDAI, 60],
        ]),
        'Alice balances are incorrect'
      )
      ok(
        await balances(bobAddress, [
          [tokenAST, 250],
          [tokenDAI, 940],
        ]),
        'Bob balances are incorrect'
      )
      // Alice approved all her AST
      ok(
        await allowances(aliceAddress, swapAddress, [
          [tokenAST, 750],
          [tokenDAI, 0],
        ])
      )

      ok(
        await allowances(bobAddress, swapAddress, [
          [tokenAST, 0],
          [tokenDAI, 940],
        ])
      )
    })
  })

  describe('Sender Delegation (Sender-side)', async () => {
    let _order

    before('Alice creates an order for Bob (50 AST for 10 DAI)', async () => {
      _order = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
          token: tokenAST.address,
          amount: 50,
        },
        sender: {
          wallet: bobAddress,
          token: tokenDAI.address,
          amount: 10,
        },
      })

      _order.signature = await signatures.getWeb3Signature(
        _order,
        aliceAddress,
        swapAddress,
        GANACHE_PROVIDER
      )
    })

    it('Checks that Carol cannot take an order on behalf of Bob', async () => {
      await reverted(
        swap(_order, { from: carolAddress }),
        'SENDER_UNAUTHORIZED'
      )
    })

    it('Bob tries to unsuccessfully authorize himself to be an authorized sender', async () => {
      await reverted(
        swapContract.authorizeSender(bobAddress, {
          from: bobAddress,
        }),
        'INVALID_AUTH_SENDER'
      )
    })

    it('Bob authorizes Carol to take orders on his behalf', async () => {
      emitted(
        await swapContract.authorizeSender(carolAddress, {
          from: bobAddress,
        }),
        'AuthorizeSender'
      )
    })

    it('Bob authorizes Carol a second time does not emit an event', async () => {
      notEmitted(
        await swapContract.authorizeSender(carolAddress, {
          from: bobAddress,
        }),
        'AuthorizeSender'
      )
    })

    it('Checks that Carol can take an order on behalf of Bob', async () => {
      emitted(await swap(_order, { from: carolAddress }), 'Swap')
    })

    it('Bob revokes sender authorization from Carol', async () => {
      emitted(
        await swapContract.revokeSender(carolAddress, { from: bobAddress }),
        'RevokeSender'
      )
    })

    it('Bob fails to revoke sender authorization from Carol a second time', async () => {
      notEmitted(
        await swapContract.revokeSender(carolAddress, { from: bobAddress }),
        'RevokeSender'
      )
    })

    it('Checks that Carol can no longer take orders on behalf of Bob', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
        },
        sender: {
          wallet: bobAddress,
        },
      })
      await reverted(swap(order, { from: carolAddress }), 'SENDER_UNAUTHORIZED')
    })

    it('Checks remaining balances and approvals', async () => {
      // Alice and Bob swapped 50 AST for 10 DAI again. Previous balances were:
      // Alice 700 AST 120 DAI, Bob 300 AST 880 DAI
      ok(
        await balances(aliceAddress, [
          [tokenAST, 700],
          [tokenDAI, 70],
        ]),
        'Alice balances are incorrect'
      )
      ok(
        await balances(bobAddress, [
          [tokenAST, 300],
          [tokenDAI, 930],
        ]),
        'Bob balances are incorrect'
      )
      ok(
        await allowances(aliceAddress, swapAddress, [
          [tokenAST, 700],
          [tokenDAI, 0],
        ])
      )
      ok(
        await allowances(bobAddress, swapAddress, [
          [tokenAST, 0],
          [tokenDAI, 930],
        ])
      )
    })
  })

  describe('Signer and Sender Delegation (Three Way)', async () => {
    it('Alice approves David to make orders on her behalf', async () => {
      emitted(
        await swapContract.authorizeSigner(davidAddress, {
          from: aliceAddress,
        }),
        'AuthorizeSigner'
      )
    })

    it('Bob approves David to take orders on his behalf', async () => {
      emitted(
        await swapContract.authorizeSender(davidAddress, {
          from: bobAddress,
        }),
        'AuthorizeSender'
      )
    })

    it('Alice gives an unsigned order to David who takes it for Bob', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
          token: tokenAST.address,
          amount: 25,
        },
        sender: {
          wallet: bobAddress,
          token: tokenDAI.address,
          amount: 5,
        },
      })

      emitted(
        await swap(order, {
          from: davidAddress,
        }),
        'Swap'
      )
    })

    it('Checks remaining balances and approvals', async () => {
      // Alice and Bob swapped 25 AST for 5 DAI. Previous balances were:
      // Alice 675 AST 125 DAI, Bob 325 AST 875 DAI
      ok(
        await balances(aliceAddress, [
          [tokenAST, 675],
          [tokenDAI, 75],
        ]),
        'Alice balances are incorrect'
      )
      ok(
        await balances(bobAddress, [
          [tokenAST, 325],
          [tokenDAI, 925],
        ]),
        'Bob balances are incorrect'
      )
      ok(
        await allowances(aliceAddress, swapAddress, [
          [tokenAST, 675],
          [tokenDAI, 0],
        ])
      )
      ok(
        await allowances(bobAddress, swapAddress, [
          [tokenAST, 0],
          [tokenDAI, 925],
        ])
      )
    })
  })

  describe('Signer and Sender Delegation (Four Way)', async () => {
    it('Bob approves Carol to take orders on his behalf', async () => {
      emitted(
        await swapContract.authorizeSender(carolAddress, {
          from: bobAddress,
        }),
        'AuthorizeSender'
      )
    })

    it('David makes an order for Alice, Carol takes the order for Bob', async () => {
      // Alice has already approved David in the previous section
      const order = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
          token: tokenAST.address,
          amount: 25,
        },
        sender: {
          wallet: bobAddress,
          token: tokenDAI.address,
          amount: 5,
        },
      })

      order.signature = await signatures.getWeb3Signature(
        order,
        davidAddress,
        swapAddress,
        GANACHE_PROVIDER
      )

      emitted(await swap(order, { from: carolAddress }), 'Swap')
    })

    it('Bob revokes the authorization to Carol', async () => {
      emitted(
        await swapContract.revokeSender(carolAddress, {
          from: bobAddress,
        }),
        'RevokeSender'
      )
    })

    it('Checks remaining balances and approvals', async () => {
      // Alice and Bob swapped 25 AST for 5 DAI. Previous balances were:
      // Alice 650 AST 130 DAI, Bob 350 AST 870 DAI
      ok(
        await balances(aliceAddress, [
          [tokenAST, 650],
          [tokenDAI, 80],
        ]),
        'Alice balances are incorrect'
      )
      ok(
        await balances(bobAddress, [
          [tokenAST, 350],
          [tokenDAI, 920],
        ]),
        'Bob balances are incorrect'
      )
      ok(
        await allowances(aliceAddress, swapAddress, [
          [tokenAST, 650],
          [tokenDAI, 0],
        ])
      )
      ok(
        await allowances(bobAddress, swapAddress, [
          [tokenAST, 0],
          [tokenDAI, 920],
        ])
      )
    })
  })

  describe('Cancels', async () => {
    let _orderOne
    let _orderTwo
    let _orderThree

    before('Alice creates orders with nonces 1, 2, 3', async () => {
      const orderOne = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
        },
        nonce: 1,
      })
      const orderTwo = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
        },
        nonce: 2,
      })
      const orderThree = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
        },
        nonce: 3,
      })

      _orderOne = orderOne
      _orderTwo = orderTwo
      _orderThree = orderThree
    })

    it('Checks that Alice is able to cancel order with nonce 1', async () => {
      emitted(await cancel([_orderOne.nonce], { from: aliceAddress }), 'Cancel')
    })
    it('Checks that Alice is unable to cancel order with nonce 1 twice', async () => {
      notEmitted(
        await cancel([_orderOne.nonce], { from: aliceAddress }),
        'Cancel'
      )
    })

    it('Checks that Bob is unable to take an order with nonce 1', async () => {
      await reverted(
        swap(_orderOne, { from: bobAddress }),
        'ORDER_TAKEN_OR_CANCELLED'
      )
    })

    it('Checks that Alice is able to set a minimum nonce of 4', async () => {
      emitted(await cancelUpTo(4, { from: aliceAddress }), 'CancelUpTo')
    })

    it('Checks that Bob is unable to take an order with nonce 2', async () => {
      await reverted(swap(_orderTwo, { from: bobAddress }), 'NONCE_TOO_LOW')
    })

    it('Checks that Bob is unable to take an order with nonce 3', async () => {
      await reverted(swap(_orderThree, { from: bobAddress }), 'NONCE_TOO_LOW')
    })

    it('Checks existing balances (Alice 650 AST and 180 DAI, Bob 350 AST and 820 DAI)', async () => {
      // No swaps happened in this section
      ok(
        await balances(aliceAddress, [
          [tokenAST, 650],
          [tokenDAI, 80],
        ]),
        'Alice balances are incorrect'
      )
      ok(
        await balances(bobAddress, [
          [tokenAST, 350],
          [tokenDAI, 920],
        ]),
        'Bob balances are incorrect'
      )
      ok(
        await allowances(aliceAddress, swapAddress, [
          [tokenAST, 650],
          [tokenDAI, 0],
        ])
      )
      ok(
        await allowances(bobAddress, swapAddress, [
          [tokenAST, 0],
          [tokenDAI, 920],
        ])
      )
    })
  })

  describe('Swaps with Fees', async () => {
    it('Checks that Carol gets paid 50 AST for facilitating a trade between Alice and Bob', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
          token: tokenAST.address,
          amount: 100,
        },
        sender: {
          wallet: bobAddress,
          token: tokenDAI.address,
          amount: 50,
        },
        affiliate: {
          wallet: carolAddress,
          token: tokenAST.address,
          amount: 50,
        },
      })

      order.signature = await signatures.getWeb3Signature(
        order,
        aliceAddress,
        swapAddress,
        GANACHE_PROVIDER
      )

      emitted(await swap(order, { from: bobAddress }), 'Swap')
    })

    it('Checks balances...', async () => {
      ok(
        await balances(aliceAddress, [
          [tokenAST, 500],
          [tokenDAI, 130],
        ]),
        'Alice balances are incorrect'
      )
      ok(
        await balances(bobAddress, [
          [tokenAST, 450],
          [tokenDAI, 870],
        ]),
        'Bob balances are incorrect'
      )
      ok(
        await balances(carolAddress, [
          [tokenAST, 50],
          [tokenDAI, 0],
        ]),
        'Carol balances are incorrect'
      )
    })
  })

  describe('Swap with Public Orders (No Sender Set)', async () => {
    it('Checks that a Swap succeeds without a sender wallet set', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
          token: tokenAST.address,
          amount: 5,
        },
        sender: {
          token: tokenDAI.address,
          amount: '0',
        },
      })

      order.signature = await signatures.getWeb3Signature(
        order,
        aliceAddress,
        swapAddress,
        GANACHE_PROVIDER
      )

      emitted(await swap(order, { from: bobAddress }), 'Swap')
    })
  })

  describe('Signatures', async () => {
    const eveAddress = '0x9d2fB0BCC90C6F3Fa3a98D2C760623a4F6Ee59b4'
    const evePrivKey = Buffer.from(
      '4934d4ff925f39f91e3729fbce52ef12f25fdf93e014e291350f7d314c1a096b',
      'hex'
    )

    it('Checks that an invalid signer signature will revert', async () => {
      const order = await orders.getOrder(
        {
          signer: {
            wallet: aliceAddress,
          },
          sender: {
            wallet: bobAddress,
          },
        },
        true
      )

      order.signature = signatures.getPrivateKeySignature(
        order,
        evePrivKey,
        swapAddress
      )

      order.signature.signatory = aliceAddress
      await reverted(swap(order, { from: bobAddress }), 'SIGNATURE_INVALID')
    })

    it('Alice authorizes Eve to make orders on her behalf', async () => {
      emitted(
        await swapContract.authorizeSigner(eveAddress, {
          from: aliceAddress,
        }),
        'AuthorizeSigner'
      )
    })

    it('Checks that an invalid delegate signature will revert', async () => {
      const orderOne = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
          token: tokenAST.address,
          amount: '0',
        },
        sender: {
          wallet: bobAddress,
          token: tokenDAI.address,
          amount: '0',
        },
      })
      const orderTwo = await orders.getOrder({
        signer: {
          wallet: aliceAddress,
        },
        sender: {
          wallet: bobAddress,
        },
      })
      const signatureTwo = signatures.getPrivateKeySignature(
        orderTwo,
        evePrivKey,
        swapAddress
      )
      orderOne.signature = signatureTwo
      await reverted(swap(orderOne, { from: bobAddress }), 'SIGNATURE_INVALID')
    })

    it('Checks that an invalid signature version will revert', async () => {
      const order = await orders.getOrder(
        {
          signer: {
            wallet: aliceAddress,
          },
          sender: {
            wallet: bobAddress,
          },
        },
        true
      )

      order.signature = signatures.getPrivateKeySignature(
        order,
        evePrivKey,
        swapAddress
      )

      order.signature.version = Buffer.from('00', 'hex')
      await reverted(swap(order, { from: bobAddress }), 'SIGNATURE_INVALID')
    })

    it('Checks that a private key signature is valid', async () => {
      const order = await orders.getOrder(
        {
          signer: {
            wallet: eveAddress,
            token: tokenAST.address,
            amount: '0',
          },
          sender: {
            wallet: aliceAddress,
            token: tokenDAI.address,
            amount: '0',
          },
        },
        true
      )

      order.signature = signatures.getPrivateKeySignature(
        order,
        evePrivKey,
        swapAddress
      )

      emitted(await swap(order, { from: aliceAddress }), 'Swap')
    })
    it('Checks that a typed data (EIP712) signature is valid', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: eveAddress,
          token: tokenAST.address,
          amount: '0',
        },
        sender: {
          wallet: aliceAddress,
          token: tokenDAI.address,
          amount: '0',
        },
      })

      order.signature = signatures.getTypedDataSignature(
        order,
        evePrivKey,
        swapAddress
      )

      emitted(await swap(order, { from: aliceAddress }), 'Swap')
    })
  })
})
