import { OrderConfirmationEmailMapper } from './order-confirmation-email.mapper';

describe('OrderConfirmationEmailMapper country display', () => {
  it('renders a legacy ES shipping country as España', () => {
    const mapper = new OrderConfirmationEmailMapper();
    const shippingAddress = (mapper as any).parseShippingAddress({
      name: 'Daniel Rivas',
      city: 'Madrid',
      country: 'ES',
    });

    expect(shippingAddress).toEqual(
      expect.objectContaining({ country: 'España' }),
    );
  });
});
